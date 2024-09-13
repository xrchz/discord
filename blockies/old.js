import 'dotenv/config'
import { ethers } from 'ethers'
import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createIcon } from './blockies.js'

const snowflakeToTimestamp = snowflake =>
  parseInt((BigInt(snowflake) >> 22n) + 1420070400000n)

const headers = {
  'Authorization': `Bot ${process.env.BOT_TOKEN}`,
  'User-Agent': `DiscordBot (https://github.com/xrchz/discord/tree/main/blockies, 1)`
}

const messages = JSON.parse(readFileSync('messages.json'))
const responses = JSON.parse(readFileSync('responses.json'))

console.log(`Read ${messages.length} known messages + ${responses.length} responses`)

const lastResponse = responses.at(-1)?.id
const lastMessage = messages[0]?.id
const lastId = lastResponse ? lastMessage ?
  snowflakeToTimestamp(lastResponse) > snowflakeToTimestamp(lastMessage) ? lastResponse : lastMessage
  : lastResponse : lastMessage
const after = lastId ? `?after=${lastId}` : ''

console.log(`lastResponse ${lastResponse}`)
console.log(`lastMessage ${lastMessage}`)
console.log(`lastResponse time ${new Date(snowflakeToTimestamp(lastResponse))}`)
console.log(`lastMessage time ${new Date(snowflakeToTimestamp(lastMessage))}`)

console.log(`Reading messages ${after}`)

const newMessagesResponse = await fetch(
  `https://discord.com/api/v10/channels/${process.env.ADDRESS_CHANNEL}/messages${after}`,
  {headers}
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
const ensRegex = /[\S--`]+\.eth/v // overly permissive, but we will also resolve
const addresses = []
for (const {author: {id: user, username: name}, content} of messages) {
  const addr = addressRegex.exec(content)?.[0]
  if (addr) addresses.push({user, name, addr})
  else {
    const ens = ensRegex.exec(content)?.[0]
    const addr = ens && await provider.resolveName(ens)
    if (addr) addresses.push({user, name, addr})
  }
}

console.log(`Got ${addresses.length} addresses: ${addresses.slice(0, 3).map(x => JSON.stringify(x))},...`)

const doneIcon = new Map()

const responseRegex = /<@([0-9]+)>: (0x[0-9a-fA-F]{40})/

for (const {embeds: [{description}]} of responses) {
  const [, user, addr] = responseRegex.exec(description)
  if (!doneIcon.has(user)) doneIcon.set(user, new Set())
  const addrs = doneIcon.get(user)
  addrs.add(addr)
  console.log(`Marking ${addr} for ${user} already done from responses`)
}

const icons = []
for (const {user, name, addr} of addresses) {
  if (!doneIcon.has(user)) doneIcon.set(user, new Set())
  const addrs = doneIcon.get(user)
  if (addrs.has(addr)) continue
  console.log(`Processing ${name}(@${user}): ${addr}`)
  addrs.add(addr)
  const ens = await provider.lookupAddress(addr)
  writeFileSync(`${addr}.png`, createIcon({seed: addr.toLowerCase()}).toBuffer('image/png'))
  icons.push({user, name, addr, ens})
}

console.log(`Got ${icons.length} icons to send`)

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
  const url = `https://discord.com/api/v10/channels/${process.env.ADDRESS_CHANNEL}/messages`
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

if (icons.length) {
  console.log(`Saving new responses`)
  writeFileSync('responses.json', JSON.stringify(responses))
}
