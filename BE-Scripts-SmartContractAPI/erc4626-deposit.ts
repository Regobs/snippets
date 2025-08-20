import 'dotenv/config'
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
} from 'viem'
import { mainnet, sepolia } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'

/** ---------- ENV ---------- */
const RPC_URL = process.env.RPC_URL!
const PK = process.env.PRIVATE_KEY as `0x${string}`
const CHAIN = (process.env.CHAIN || 'mainnet').toLowerCase()
const VAULT = (process.env.VAULT ||
  '0x8eB67A509616cd6A7c1B3c8C21D48FF57df3d458') as `0x${string}`
const AMOUNT_HUMAN = process.env.AMOUNT || '50.0'

const chain = CHAIN === 'sepolia' ? sepolia : mainnet

/** ---------- CLIENTS ---------- */
const publicClient = createPublicClient({ chain, transport: http(RPC_URL) })
const account = privateKeyToAccount(PK)
const walletClient = createWalletClient({ account, chain, transport: http(RPC_URL) })

/** ---------- ABIs ---------- */
const ERC20 = parseAbi([
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 value) returns (bool)',
])

const ERC4626 = parseAbi([
  'function asset() view returns (address)',
  'function maxDeposit(address) view returns (uint256)',
  'function previewDeposit(uint256 assets) view returns (uint256 shares)',
  'function deposit(uint256 assets, address receiver) returns (uint256 shares)',
  'function balanceOf(address) view returns (uint256)',
])

/** ---------- HELPERS ---------- */
function parseUnits(value: string, decimals: number): bigint {
  const [whole, fracRaw = ''] = value.split('.')
  const frac = fracRaw.padEnd(decimals, '0').slice(0, decimals)
  const num = (whole || '0') + (decimals ? frac : '')
  return BigInt(num || '0')
}
function formatUnits(value: bigint, decimals: number): string {
  const s = value.toString().padStart(decimals + 1, '0')
  const i = s.length - decimals
  const w = s.slice(0, i)
  const f = s.slice(i).replace(/0+$/, '')
  return f ? `${w}.${f}` : w
}

/** ---------- MAIN ---------- */
async function main() {
  console.log(`Network: ${chain.name}`)
  console.log(`Vault:   ${VAULT}`)
  console.log(`Sender:  ${account.address}`)

  // 1) Find the underlying asset (USDC for this vault)
  const underlying = (await publicClient.readContract({
    address: VAULT,
    abi: ERC4626,
    functionName: 'asset',
  })) as `0x${string}`

  const [symbol, decimals, name] = await Promise.all([
    publicClient.readContract({ address: underlying, abi: ERC20, functionName: 'symbol' }) as Promise<string>,
    publicClient.readContract({ address: underlying, abi: ERC20, functionName: 'decimals' }) as Promise<number>,
    publicClient.readContract({ address: underlying, abi: ERC20, functionName: 'name' }) as Promise<string>,
  ])
  console.log(`Underlying: ${name} (${symbol}) @ ${underlying} | decimals=${decimals}`)

  // 2) Convert "AMOUNT" to base units (USDC has 6)
  const assetsWei = parseUnits(AMOUNT_HUMAN, decimals)
  console.log(`Deposit amount: ${AMOUNT_HUMAN} ${symbol} = ${assetsWei} base units`)

  // 3) Basic safety checks
  const [maxDep, myBal] = await Promise.all([
    publicClient.readContract({ address: VAULT, abi: ERC4626, functionName: 'maxDeposit', args: [account.address] }) as Promise<bigint>,
    publicClient.readContract({ address: underlying, abi: ERC20, functionName: 'balanceOf', args: [account.address] }) as Promise<bigint>,
  ])
  if (maxDep === 0n) throw new Error('Vault not accepting deposits (maxDeposit = 0).')
  if (assetsWei > maxDep) throw new Error(`Amount exceeds maxDeposit: max=${formatUnits(maxDep, decimals)} ${symbol}`)
  if (myBal < assetsWei) throw new Error(`Insufficient ${symbol}. Have ${formatUnits(myBal, decimals)}, need ${AMOUNT_HUMAN}`)

  // (Optional) preview expected shares (informational)
  const previewShares = await publicClient.readContract({
    address: VAULT, abi: ERC4626, functionName: 'previewDeposit', args: [assetsWei],
  }) as bigint
  console.log(`Preview shares (info): ${previewShares.toString()}`)

  // 4) Ensure allowance (approve if needed)
  const allowance = await publicClient.readContract({
    address: underlying, abi: ERC20, functionName: 'allowance',
    args: [account.address, VAULT],
  }) as bigint

  if (allowance < assetsWei) {
    console.log(`Approving ${AMOUNT_HUMAN} ${symbol} to vault...`)
    const { request } = await publicClient.simulateContract({
      account,
      address: underlying,
      abi: ERC20,
      functionName: 'approve',
      args: [VAULT, assetsWei], // or a larger allowance if you prefer fewer approvals
    })
    const approveHash = await walletClient.writeContract(request) // signs & broadcasts
    await publicClient.waitForTransactionReceipt({ hash: approveHash })
    console.log(`Approve tx: ${approveHash}`)
  } else {
    console.log('Allowance already sufficient, skipping approve.')
  }

  // 5) Deposit
  console.log('Sending deposit...')
  const { request } = await publicClient.simulateContract({
    account,
    address: VAULT,
    abi: ERC4626,
    functionName: 'deposit',
    args: [assetsWei, account.address],
  })
  const depositHash = await walletClient.writeContract(request) // signs & broadcasts
  const receipt = await publicClient.waitForTransactionReceipt({ hash: depositHash })
  console.log(`Deposit tx: ${depositHash} | status: ${receipt.status}`)

  // 6) Show resulting share balance
  const shareBal = await publicClient.readContract({
    address: VAULT, abi: ERC4626, functionName: 'balanceOf', args: [account.address],
  }) as bigint
  console.log(`Your vault share balance (raw): ${shareBal.toString()}`)

  console.log('Done ✅')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})