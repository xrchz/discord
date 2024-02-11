import 'dotenv/config'
import { ethers } from 'ethers'
import { readFileSync, writeFileSync } from 'node:fs'
import { createIcon } from './blockies.js'

const provider = new ethers.JsonRpcProvider(process.env.RPC || 'http://localhost:8545')
const addresses = JSON.parse(readFileSync('addresses.json'))
const outputted = new Map()
const output = []
for (const {user, name, addr} of addresses) {
  if (!outputted.has(user)) outputted.set(user, new Set())
  const addrs = outputted.get(user)
  if (addrs.has(addr)) continue
  console.log(`Processing ${name}(@${user}): ${addr}`)
  addrs.add(addr)
  const ens = await provider.lookupAddress(addr)
  writeFileSync(`${addr}.png`, createIcon({seed: addr.toLowerCase()}).toBuffer('image/png'))
  output.push({user, name, addr, ens})
}
writeFileSync('icons.json', JSON.stringify(output))
