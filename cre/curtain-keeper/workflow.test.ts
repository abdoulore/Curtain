import { describe, expect } from 'bun:test'
import {
	addContractMock,
	EvmMock,
	HttpActionsMock,
	newTestRuntime,
	REPORT_METADATA_HEADER_LENGTH,
	test,
	type WriteReportMockInput,
} from '@chainlink/cre-sdk/test'
import { type Address, bytesToHex, decodeAbiParameters, getAddress } from 'viem'
import { type Config, encodeJobs, initWorkflow, keeperAbi, mergeShows, onCronTrigger, SHOWS_QUERY } from './workflow'

const MONAD_TESTNET = 2183018362218727504n
const KEEPER = "0xC157558da8C7d90EAE75C38A850515567ED5a18E" as Address
const CANCELLED = '0xC0731dA73709F548f28f9d373E36e79d1a1Ed29A' as Address
const ENDING = '0x537a071e81734ecd498FC0D3CE8c36AfEDcB9A09' as Address
const DEMO = '0xd3F22B52F74D658318C29E0475E1833214eCA005' as Address

const config = (over: Partial<Config> = {}): Config => ({
	schedule: '0 */5 * * * *',
	chainSelectorName: 'monad-testnet',
	keeperAddress: KEEPER,
	envioUrl: 'https://indexer.example/v1/graphql',
	events: [DEMO],
	gasLimit: '1500000',
	...over,
})

const runtimeWith = (c: Config) => {
	const runtime = newTestRuntime<Config>()
	;(runtime as unknown as { config: Config }).config = c
	return runtime
}

const indexerReturns = (ids: string[]) => {
	const http = HttpActionsMock.testInstance()
	http.sendRequest = (req) => {
		expect(JSON.parse(Buffer.from(req.body as Uint8Array).toString())).toEqual({ query: SHOWS_QUERY })
		return {
			statusCode: 200,
			body: Buffer.from(JSON.stringify({ data: { Show: ids.map((id) => ({ id })) } })).toString('base64'),
		}
	}
	return http
}

const decodeReport = (input: WriteReportMockInput) =>
	decodeAbiParameters(
		[
			{
				type: 'tuple[]',
				components: [
					{ name: 'eventAddress', type: 'address' },
					{ name: 'action', type: 'uint8' },
				],
			},
		],
		bytesToHex(input.report.rawReport.slice(REPORT_METADATA_HEADER_LENGTH)),
	)[0]

describe('mergeShows', () => {
	test('dedups, checksums and sorts by address', () => {
		expect(mergeShows([DEMO], [DEMO.toLowerCase(), ENDING.toLowerCase(), CANCELLED.toLowerCase()])).toEqual([
			ENDING,
			CANCELLED,
			DEMO,
		])
	})
})

describe('encodeJobs', () => {
	test('matches the keeper Job[] layout', () => {
		const encoded = encodeJobs([{ eventAddress: CANCELLED, action: 2 }])
		const [jobs] = decodeAbiParameters(
			[{ type: 'tuple[]', components: [{ type: 'address' }, { type: 'uint8' }] }],
			encoded,
		)
		expect(jobs).toEqual([[CANCELLED, 2]] as never)
	})
})

describe('onCronTrigger', () => {
	test('reports the jobs the keeper says are due', () => {
		indexerReturns([CANCELLED.toLowerCase(), ENDING.toLowerCase()])
		const evm = EvmMock.testInstance(MONAD_TESTNET)
		const keeper = addContractMock(evm, { address: KEEPER, abi: keeperAbi })
		let asked: readonly Address[] = []
		keeper.pending = (shows) => {
			asked = shows as readonly Address[]
			return [
				{ eventAddress: CANCELLED, action: 2 },
				{ eventAddress: ENDING, action: 1 },
			]
		}
		let reported: readonly { eventAddress: Address; action: number }[] = []
		keeper.writeReport = (input) => {
			expect(getAddress(bytesToHex(input.receiver))).toBe(KEEPER)
			expect(input.gasConfig.gasLimit).toBe(1500000n)
			reported = decodeReport(input)
			return { txStatus: 'TX_STATUS_SUCCESS', txHash: Buffer.alloc(32, 0xab).toString('base64') }
		}

		const result = onCronTrigger(runtimeWith(config()))

		expect(asked).toEqual([ENDING, CANCELLED, DEMO])
		expect(reported).toEqual([
			{ eventAddress: CANCELLED, action: 2 },
			{ eventAddress: ENDING, action: 1 },
		])
		expect(result).toBe(`Kept 2 show(s): 0x${'ab'.repeat(32)}`)
	})

	test('stays idle when nothing is due', () => {
		indexerReturns([DEMO])
		const evm = EvmMock.testInstance(MONAD_TESTNET)
		const keeper = addContractMock(evm, { address: KEEPER, abi: keeperAbi })
		keeper.pending = () => []
		keeper.writeReport = () => {
			throw new Error('must not write')
		}
		expect(onCronTrigger(runtimeWith(config()))).toBe('Idle: nothing due')
	})

	test('checks the configured shows when the indexer is down', () => {
		const http = HttpActionsMock.testInstance()
		http.sendRequest = () => ({ statusCode: 502, body: Buffer.from('{"errors":["down"]}').toString('base64') })
		const evm = EvmMock.testInstance(MONAD_TESTNET)
		const keeper = addContractMock(evm, { address: KEEPER, abi: keeperAbi })
		let asked: readonly Address[] = []
		keeper.pending = (shows) => {
			asked = shows as readonly Address[]
			return []
		}
		onCronTrigger(runtimeWith(config()))
		expect(asked).toEqual([DEMO])
	})

	test('skips discovery without an indexer url', () => {
		const evm = EvmMock.testInstance(MONAD_TESTNET)
		const keeper = addContractMock(evm, { address: KEEPER, abi: keeperAbi })
		let asked: readonly Address[] = []
		keeper.pending = (shows) => {
			asked = shows as readonly Address[]
			return []
		}
		onCronTrigger(runtimeWith(config({ envioUrl: '', events: [ENDING, CANCELLED] })))
		expect(asked).toEqual([ENDING, CANCELLED])
	})

	test('fails loudly when the keeper reverts', () => {
		indexerReturns([])
		const evm = EvmMock.testInstance(MONAD_TESTNET)
		const keeper = addContractMock(evm, { address: KEEPER, abi: keeperAbi })
		keeper.pending = () => [{ eventAddress: DEMO, action: 1 }]
		keeper.writeReport = () => ({
			txStatus: 'TX_STATUS_SUCCESS',
			receiverContractExecutionStatus: 'RECEIVER_CONTRACT_EXECUTION_STATUS_REVERTED',
		})
		expect(() => onCronTrigger(runtimeWith(config()))).toThrow('CurtainKeeper.onReport reverted')
	})

	test('fails loudly when the transaction fails', () => {
		indexerReturns([])
		const evm = EvmMock.testInstance(MONAD_TESTNET)
		const keeper = addContractMock(evm, { address: KEEPER, abi: keeperAbi })
		keeper.pending = () => [{ eventAddress: DEMO, action: 1 }]
		keeper.writeReport = () => ({ txStatus: 'TX_STATUS_REVERTED', errorMessage: 'out of gas' })
		expect(() => onCronTrigger(runtimeWith(config()))).toThrow('Keeper report failed: out of gas')
	})
})

describe('initWorkflow', () => {
	test('runs on the configured cron schedule', () => {
		const handlers = initWorkflow(config())
		expect(handlers).toHaveLength(1)
		expect(handlers[0].fn).toBe(onCronTrigger)
		const trigger = handlers[0].trigger as { config?: { schedule?: string } }
		expect(trigger.config?.schedule).toBe('0 */5 * * * *')
	})
})
