import {
	bytesToHex,
	consensusIdenticalAggregation,
	cre,
	encodeCallMsg,
	getNetwork,
	type HTTPSendRequester,
	json,
	LAST_FINALIZED_BLOCK_NUMBER,
	prepareReportRequest,
	type Runtime,
	TxStatus,
} from '@chainlink/cre-sdk'
import {
	type Address,
	decodeFunctionResult,
	encodeAbiParameters,
	encodeFunctionData,
	getAddress,
	isAddress,
	parseAbi,
	zeroAddress,
} from 'viem'
import { z } from 'zod'

// ─── Config ─────────────────────────────────────────────────
export const configSchema = z.object({
	schedule: z.string(),
	chainSelectorName: z.string(),
	keeperAddress: z.string().refine(isAddress),
	/** Envio GraphQL endpoint that lists every show the factory created. Empty skips discovery. */
	envioUrl: z.string(),
	/** Shows always checked, even if the indexer is down. */
	events: z.array(z.string().refine(isAddress)),
	gasLimit: z.string(),
})
export type Config = z.infer<typeof configSchema>

export const keeperAbi = parseAbi([
	'struct Job { address eventAddress; uint8 action; }',
	'function pending(address[] events) view returns (Job[] jobs)',
])
export const ACTIONS = ['None', 'Settle', 'PushRefunds'] as const
export type Job = { eventAddress: Address; action: number }

// Only shows that can still need work: open ones may need settling, cancelled and not-held ones may owe refunds.
export const SHOWS_QUERY = '{ Show(where: { status: { _in: [Open, Cancelled, NotHeld] } }) { id } }'

// ─── Steps ──────────────────────────────────────────────────

/** Asks the indexer for live shows. Every node gets the same answer, so identical aggregation applies. */
export const fetchShows = (sendRequester: HTTPSendRequester, config: Config): string => {
	const resp = sendRequester
		.sendRequest({
			url: config.envioUrl,
			method: 'POST' as const,
			headers: { 'Content-Type': 'application/json' },
			body: Buffer.from(JSON.stringify({ query: SHOWS_QUERY })).toString('base64'),
		})
		.result()
	const body = json(resp) as { data?: { Show?: { id: string }[] }; errors?: unknown[] }
	if (body.errors?.length || !body.data?.Show) throw new Error(`indexer query failed: ${JSON.stringify(body.errors)}`)
	return JSON.stringify(body.data.Show.map((s) => s.id).sort())
}

/** Config list plus whatever the indexer knows, deduplicated and checksummed. */
export const mergeShows = (configured: readonly string[], indexed: readonly string[]): Address[] =>
	[...new Set([...configured, ...indexed].map((a) => getAddress(a)))].sort((a, b) =>
		a.toLowerCase() < b.toLowerCase() ? -1 : 1,
	)

export const encodeJobs = (jobs: readonly Job[]) =>
	encodeAbiParameters(
		[
			{
				type: 'tuple[]',
				components: [
					{ name: 'eventAddress', type: 'address' },
					{ name: 'action', type: 'uint8' },
				],
			},
		],
		[jobs.map((j) => ({ eventAddress: j.eventAddress, action: j.action }))],
	)

const discover = (runtime: Runtime<Config>): Address[] => {
	const configured = runtime.config.events
	if (!runtime.config.envioUrl) return mergeShows(configured, [])
	try {
		const indexed = new cre.capabilities.HTTPClient()
			.sendRequest(runtime, fetchShows, consensusIdenticalAggregation<string>())(runtime.config)
			.result()
		return mergeShows(configured, JSON.parse(indexed) as string[])
	} catch (e) {
		// The keeper still checks the configured shows when the indexer is unreachable.
		runtime.log(`Indexer unavailable, using configured shows only: ${(e as Error).message}`)
		return mergeShows(configured, [])
	}
}

// ─── Callback ───────────────────────────────────────────────
export const onCronTrigger = (runtime: Runtime<Config>): string => {
	const { config } = runtime
	const network = getNetwork({ chainFamily: 'evm', chainSelectorName: config.chainSelectorName, isTestnet: true })
	if (!network) throw new Error(`Network not found: ${config.chainSelectorName}`)
	const evm = new cre.capabilities.EVMClient(network.chainSelector.selector)
	const keeper = getAddress(config.keeperAddress)

	// 1. Which shows to look at.
	const shows = discover(runtime)
	runtime.log(`Checking ${shows.length} shows`)
	if (shows.length === 0) return 'Idle: no shows'

	// 2. What each one needs, decided onchain by the keeper so the rule lives in one tested place.
	const read = evm
		.callContract(runtime, {
			call: encodeCallMsg({
				from: zeroAddress,
				to: keeper,
				data: encodeFunctionData({ abi: keeperAbi, functionName: 'pending', args: [shows] }),
			}),
			blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
		})
		.result()
	const jobs = decodeFunctionResult({
		abi: keeperAbi,
		functionName: 'pending',
		data: bytesToHex(read.data),
	}) as readonly Job[]

	if (jobs.length === 0) {
		runtime.log('Nothing to settle or refund')
		return 'Idle: nothing due'
	}
	for (const j of jobs) runtime.log(`${ACTIONS[j.action]} ${j.eventAddress}`)

	// 3. One signed report carries every job; the forwarder delivers it to CurtainKeeper.onReport.
	const report = runtime.report(prepareReportRequest(encodeJobs(jobs))).result()
	const write = evm
		.writeReport(runtime, { receiver: keeper, report, gasConfig: { gasLimit: config.gasLimit } })
		.result()

	if (write.txStatus !== TxStatus.SUCCESS) {
		throw new Error(`Keeper report failed: ${write.errorMessage || write.txStatus}`)
	}
	if (write.receiverContractExecutionStatus !== undefined && write.receiverContractExecutionStatus !== 0) {
		throw new Error(`CurtainKeeper.onReport reverted: status ${write.receiverContractExecutionStatus}`)
	}
	const txHash = bytesToHex(write.txHash || new Uint8Array(32))
	runtime.log(`Report delivered: ${txHash}`)
	return `Kept ${jobs.length} show(s): ${txHash}`
}

// ─── Workflow ───────────────────────────────────────────────
export function initWorkflow(config: Config) {
	const cron = new cre.capabilities.CronCapability()
	return [cre.handler(cron.trigger({ schedule: config.schedule }), onCronTrigger)]
}
