import "server-only";
import { BaseError, ContractFunctionRevertedError, InsufficientFundsError, type Abi, type Address, type Hash, type TransactionReceipt } from "viem";
import { nonceManager } from "viem/accounts";
import { monadTestnet } from "@/lib/chain";
import { publicClient, type Wallet } from "./clients";

export class RelayError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

/** Turns a viem error into a RelayError, keeping the contract's custom error name when there is one. */
export function toRelayError(error: unknown): RelayError {
  if (error instanceof RelayError) return error;
  if (error instanceof BaseError) {
    const reverted = error.walk((e) => e instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError) {
      const name = reverted.data?.errorName ?? "Reverted";
      const args = reverted.data?.args?.map((a) => (typeof a === "bigint" ? a.toString() : a));
      return new RelayError(400, name, reverted.shortMessage, args);
    }
    if (error.walk((e) => e instanceof InsufficientFundsError) instanceof InsufficientFundsError) {
      return new RelayError(503, "RelayerRefilling", "The relayer is out of gas money");
    }
    return new RelayError(502, "RpcError", error.shortMessage);
  }
  return new RelayError(500, "InternalError", error instanceof Error ? error.message : String(error));
}

export type Sent = { hash: Hash; receipt: TransactionReceipt; estimate: bigint; gasLimit: bigint };

/**
 * Simulates first, so a call that would revert never costs gas, then sends with the gas limit at the
 * estimate plus 10%. Monad charges the gas limit, not the gas used. A refused simulation is never charged.
 */
export async function sendContract(
  wallet: Wallet,
  call: { address: Address; abi: Abi; functionName: string; args: readonly unknown[] },
  /** Runs with the gas limit before sending, and may refuse (the route's daily gas ceiling). */
  guard?: (gasLimit: bigint) => Promise<void>,
): Promise<Sent> {
  const account = wallet.account;
  let estimate: bigint;
  try {
    estimate = await publicClient.estimateContractGas({ ...call, account } as never);
  } catch (error) {
    throw toRelayError(error);
  }
  const gasLimit = estimate + estimate / 10n;
  await guard?.(gasLimit);

  for (let attempt = 0; ; attempt++) {
    try {
      const hash = await wallet.writeContract({ ...call, gas: gasLimit, account, chain: monadTestnet } as never);
      const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 30_000 });
      if (receipt.status !== "success") throw new RelayError(409, "RevertedOnchain", `Transaction ${hash} reverted`);
      return { hash, receipt, estimate, gasLimit };
    } catch (error) {
      // Another instance may have used our nonce. Resync once and retry.
      if (attempt === 0 && error instanceof BaseError && /nonce/i.test(error.message)) {
        nonceManager.reset({ address: account.address, chainId: monadTestnet.id });
        continue;
      }
      throw toRelayError(error);
    }
  }
}
