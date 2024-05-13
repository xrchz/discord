import 'dotenv/config'
import { ethers } from 'ethers'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createIcon } from './blockies.js'

const snowflakeToTimestamp = snowflake =>
  parseInt((BigInt(snowflake) >> 22n) + 1420070400000n)

const botHeaders = {
  'Authorization': `Bot ${process.env.BOT_TOKEN}`,
  'User-Agent': `DiscordBot (https://github.com/xrchz/discord/tree/main/blockies, 1)`
}

const oauthHeaders = {
  ...botHeaders,
  'Authorization': `Bearer ${process.env.OAUTH_TOKEN}`
}

const messages = JSON.parse(readFileSync('messages.json'))

console.log(`Read ${messages.length} known messages`)

const lastMessage = messages[0]?.id
const after = lastMessage ? `?after=${lastMessage}` : ''

console.log(`lastMessage ${lastMessage}`)
console.log(`lastMessage time ${new Date(snowflakeToTimestamp(lastMessage))}`)

console.log(`Reading messages ${after}`)

const newMessagesResponse = await fetch(
  `https://discord.com/api/v10/channels/${process.env.ADDRESS_CHANNEL}/messages${after}`,
  {headers: botHeaders}
)
const newMessages = await newMessagesResponse.json()
messages.splice(0, 0, ...newMessages)

console.log(`After reading, ${messages.length} total known messages`)

if (newMessages.length) {
  console.log(`Saving new messages`)
  writeFileSync('messages.json', JSON.stringify(messages))
}

const provider = new ethers.JsonRpcProvider(process.env.RPC || 'http://localhost:8545')

const addressRegex = /0x[0-9a-fA-F]{40}/
const ensRegex = /\S+\.eth/ // overly permissive, but we will also resolve
const addresses = []
for (const {author: {id: user, username: name}, content, id: msg} of messages) {
  const possibleEns = ensRegex.exec(content)?.[0]
  const possibleEnsAddress = possibleEns && await provider.resolveName(possibleEns)
  const addr = addressRegex.exec(content)?.[0] || possibleEnsAddress
  if (addr) addresses.push({user, name, addr, msg, possibleEns, possibleEnsAddress})
}

console.log(`Got ${addresses.length} addresses: ${addresses.slice(0, 3).map(x => JSON.stringify(x))},...`)

const paymentMessageResponse = await fetch(
  `https://discord.com/api/v10/channels/${process.env.VERIFICATION_CHANNEL}/messages?limit=5`,
  {headers: botHeaders}
).then(r => r.json())
console.log(`paymentMessageResponse json: ${JSON.stringify(paymentMessageResponse)}`)
const paymentMessages = paymentMessageResponse?.flatMap(r =>
  r.content?.startsWith('**Payments**') || r.author?.id == process.env.ADMIN_ID
  ? [r] : []
)
console.log(`Got ${paymentMessages.length} payment messages`)
const paymentMessage = paymentMessages[0]
const paymentLines = paymentMessage?.content.split('\n')
if (paymentLines[0]?.startsWith('**Payments**')) paymentLines.shift()

console.log(`Got payment message from ${paymentMessage?.author.username} with ${paymentLines?.length} lines`)

const doneIcon = new Map()

const icons = []
for (const {user, name, addr, msg, possibleEns, possibleEnsAddress} of addresses) {
  if (!doneIcon.has(user)) doneIcon.set(user, new Set())
  const addrs = doneIcon.get(user)
  if (addrs.has(addr)) continue
  console.log(`Processing ${name}(@${user}): ${addr}`)
  addrs.add(addr)
  const ens = await provider.lookupAddress(addr)
  if (!existsSync(`${addr}.png`))
    writeFileSync(`${addr}.png`, createIcon({seed: addr.toLowerCase()}).toBuffer('image/png'))
  icons.push({user, name, addr, ens, msg, possibleEns, possibleEnsAddress})
}

console.log(`Got ${icons.length} icons`)

const paymentItems = paymentLines.map(line => {
  if (line.startsWith('~~') && line.endsWith('~~') && line.length > 4)
    return {line, status: 'error', reason: 'struck through'}
  const lineAddr = addressRegex.exec(line)?.[0]?.toLowerCase()
  const lineEns = ensRegex.exec(line)?.[0]?.toLowerCase()
  if (!lineAddr && !lineEns)
    return {line, status: 'error', reason: 'no address or ENS'}
  const matchingIcons = icons.filter(({addr, ens, possibleEns}) =>
    lineAddr === addr.toLowerCase() || (ens && lineEns === ens.toLowerCase()) ||
    possibleEns && lineEns == possibleEns.toLowerCase())
  if (!matchingIcons.length)
    return {line, status: 'error', reason: 'address or ENS unknown'}
  if (matchingIcons.length > 1)
    return {line, status: 'error', reason: 'multiple distinct addresses'}
  return {line, status: 'success', ...matchingIcons[0]}
})

console.log(`Got ${paymentItems.length} payment items: ${paymentItems.slice(0, 3).map(x => JSON.stringify(x))}...`)

const outputPayloads = paymentItems.map(({line, status, reason, addr, ens, user, name, msg}) => {
  const contents = status === 'error' ?
    {description: reason} :
    {
      description: `<@${user}>: ${addr}${ens ? ` (${ens})` : ''} https://discord.com/channels/${process.env.GUILD}/${process.env.ADDRESS_CHANNEL}/${msg}`,
      url: `https://etherscan.io/address/${addr}`,
      thumbnail:{url:`attachment://${addr}.png`, height:32, width:32}
    }
  const json = {
    embeds: [{title: line, ...contents}],
    allowed_mentions: {parse: []}
  }
  const payload_json = `payload_json=${JSON.stringify(json)};type=application/json`
  const attachments = status === 'success' && `files[0]=@${addr}.png;type=image/png;filename=${addr}.png`
  return {payload_json, attachments}
})

const url = `https://discord.com/api/v10/channels/${process.env.VERIFICATION_CHANNEL}/messages`

for (const {payload_json, attachments} of outputPayloads) {
  const res = spawnSync("curl", [
    "-X", "POST",
    "-H", `Authorization: Bot ${process.env.BOT_TOKEN}`,
    "-F", payload_json,
    "-F", attachments,
    url
  ])
  console.log(JSON.stringify(JSON.parse(res.stdout)))
  await new Promise(resolve => setTimeout(resolve, 1000))
}

/*
for (const {user, name, addr, ens} of icons) {
  const json = JSON.stringify({
    embeds:[{title:`Address for ${name}`,
             description:`<@${user}>: ${addr}${ens ? ` (${ens})` : ''}`,
             url:`https://etherscan.io/address/${addr}`,
             thumbnail:{url:`attachment://${addr}.png`,height:32,width:32}}],
    allowed_mentions:{parse:[]}
  })
  const payload_json = `payload_json=${json};type=application/json`
  const attachments = `files[0]=@${addr}.png;type=image/png;filename=${addr}.png`
  const url = `https://discord.com/api/v10/channels/${process.env.CHANNEL}/messages`
  const res = spawnSync("curl", [
    "-X", "POST",
    "-H", `Authorization: Bot ${process.env.BOT_TOKEN}`,
    "-F", payload_json,
    "-F", attachments,
    url
  ])
  responses.push(JSON.parse(res.stdout))
  await new Promise(resolve => setTimeout(resolve, 1000))
}
*/
