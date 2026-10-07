import { MeraError } from "@category-labs/mera";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContractFunctionRevertedError, encodeErrorResult, HttpRequestError, UserRejectedRequestError } from "viem";
import { curtainEventAbi, curtainFactoryAbi } from "./abis";
import { ApiError, errorCode, friendlyMessage } from "./api";
import { MESSAGES, PlainError, plainError } from "./errors";

const DEFAULT = friendlyMessage(undefined);

function reverted(errorName: string, args?: readonly unknown[]) {
  return new ContractFunctionRevertedError({
    abi: curtainEventAbi,
    data: encodeErrorResult({ abi: curtainEventAbi, errorName, args } as never),
    functionName: "checkIn",
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("plainError: passkeys", () => {
  it("reads a dismissed prompt as cancelled", () => {
    expect(plainError(new DOMException("The operation either timed out or was not allowed.", "NotAllowedError"))).toBe(
      MESSAGES.cancelled,
    );
  });

  it("says when the browser can't do passkeys", () => {
    expect(plainError(new DOMException("nope", "NotSupportedError"))).toBe(MESSAGES.unsupported);
    expect(plainError(new DOMException("nope", "SecurityError"))).toBe(MESSAGES.unsupported);
  });

  it("says when this phone already has a passkey", () => {
    expect(plainError(new DOMException("exists", "InvalidStateError"))).toBe(MESSAGES.exists);
  });

  it("looks inside Mera's wrapper for the browser's reason", () => {
    const wrapped = new MeraError("PASSKEY_OPERATION_FAILED", "failed", { cause: new DOMException("x", "NotSupportedError") });
    expect(plainError(wrapped)).toBe(MESSAGES.unsupported);
    expect(plainError(new MeraError("PASSKEY_OPERATION_FAILED", "failed"))).toBe(MESSAGES.cancelled);
    expect(plainError(new MeraError("PRF_UNAVAILABLE", "no prf"))).toBe(MESSAGES.noPrf);
    expect(plainError(new MeraError("CRYPTO_UNAVAILABLE", "no crypto"))).toBe(MESSAGES.insecure);
  });
});

describe("plainError: contract and relayer", () => {
  it("passes through messages already written for people", () => {
    expect(plainError(new ApiError("SoldOut", friendlyMessage("SoldOut")))).toBe("Sold out. Every ticket has been taken.");
    expect(plainError(new PlainError("Sign in first."))).toBe("Sign in first.");
  });

  it("names the contract's reason in plain words", () => {
    expect(plainError(reverted("SoldOut"))).toBe("Sold out. Every ticket has been taken.");
    expect(plainError(reverted("TicketNotActive", [4n]))).toBe("This ticket has already been used or refunded.");
    expect(plainError(reverted("NotGate"))).toMatch(/gate was removed/);
  });

  it("has words for every error the contracts can raise", () => {
    const internal = new Set(["FailedDeployment", "InvalidInitialization", "NotInitializing", "ReentrancyGuardReentrantCall"]);
    const names = [...curtainEventAbi, ...curtainFactoryAbi]
      .filter((x) => x.type === "error")
      .map((x) => (x as { name: string }).name)
      .filter((n) => !internal.has(n));
    expect(names.filter((n) => friendlyMessage(n) === DEFAULT)).toEqual([]);
  });

  it("has words for every code the relayer returns", () => {
    const codes = [
      "BadRequest", "GateTokenWrongEvent", "UnknownEvent", "UnsupportedToken", "WrongRpId", "GateAuthExpired",
      "GateUnauthorized", "NotOrganizer", "RevertedOnchain", "CreateLimitGlobal", "CreateLimitIp", "TopupLimitGlobal",
      "TopupLimitIp", "InternalError", "NotCreated", "RpcError", "DemoMoneyRefilling", "LimitStoreUnavailable",
    ];
    expect(codes.filter((c) => friendlyMessage(c) === DEFAULT)).toEqual([]);
  });

  it("turns a timeout or rate limit with no code into a sentence", () => {
    expect(errorCode(504, {})).toBe("ServerBusy");
    expect(errorCode(429, {})).toBe("TooManyRequests");
    expect(errorCode(400, { error: "SoldOut" })).toBe("SoldOut");
    expect(friendlyMessage("ServerBusy")).toMatch(/busy/);
  });
});

describe("plainError: network and wallets", () => {
  it("calls a failed RPC request slow, not broken", () => {
    expect(plainError(new HttpRequestError({ url: "https://testnet-rpc.monad.xyz", status: 504 }))).toBe(MESSAGES.slow);
  });

  it("reads a wallet rejection as cancelled", () => {
    expect(plainError(new UserRejectedRequestError(new Error("User rejected")))).toBe(MESSAGES.cancelled);
  });

  it("tells offline from slow when a request never left", () => {
    expect(plainError(new TypeError("Failed to fetch"))).toBe(MESSAGES.slow);
    vi.stubGlobal("navigator", { onLine: false });
    expect(plainError(new TypeError("Failed to fetch"))).toBe(MESSAGES.offline);
  });

  it("never shows a raw technical message", () => {
    expect(plainError(new Error("execution reverted: 0x8baa579f at 0xd22f6eb4"))).toBe(MESSAGES.unknown);
    expect(plainError("weird")).toBe(MESSAGES.unknown);
    expect(plainError(undefined)).toBe(MESSAGES.unknown);
  });
});
