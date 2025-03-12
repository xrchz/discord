import 'dotenv/config'
import * as fs from 'node:fs'
import { ethers } from 'ethers'
import express from 'express'
import * as https from 'https'
import { InteractionType, InteractionResponseType, verifyKeyMiddleware } from 'discord-interactions'

const app = express();

const discordApi = 'https://discord.com/api/v10'
const userAgentVersion = 1

const provider = new ethers.EtherscanProvider('mainnet', process.env.ETHERSCAN_KEY);
const ramanaAddressOneInch = '0xB0De8cB8Dcc8c5382c4b7F3E978b491140B2bC55';
const ramanaAddress = '0x65FE89a480bdB998F4116DAf2A9360632554092c';
const truncatedAddress = `${ramanaAddress.substring(0,6)}…${ramanaAddress.substring(ramanaAddress.length - 4)}`
const oneEther = ethers.parseEther('1');
const oneEtherStr = oneEther.toString();
const ethAddress = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const rETHAddress = '0xae78736Cd615f374D3085123A210448E74Fc6393';
const xrETHAddress = '0xBB22d59B73D7a6F3A8a83A214BECc67Eb3b511fE';
const wstETHAddress = '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0';
const swETHAddress = '0xf951E335afb289353dc249e82926178EaC7DEd78';
const cbETHAddress = '0xbe9895146f7af43049ca1c1ae358b0541ea49704';
// const RPLAddress = '0xD33526068D116cE69F19A9ee46F0bd304F21A51f';
const rETHContract = new ethers.Contract(rETHAddress,
  ['function getExchangeRate() view returns (uint256)'], provider);
const xrETHContract = new ethers.Contract(xrETHAddress,
  ['function convertToAssets(uint256) view returns (uint256)'], provider);
const wstETHContract = new ethers.Contract(wstETHAddress,
  ['function stEthPerToken() view returns (uint256)'], provider);
const swETHContract = new ethers.Contract(swETHAddress,
  ['function swETHToETHRate() view returns (uint256)'], provider);
const cbETHContract = new ethers.Contract(cbETHAddress,
  ['function exchangeRate() view returns (uint256)'], provider);
const spotPriceContract = new ethers.Contract('0x07D91f5fb9Bf7798734C3f606dB065549F6893bb',
  ['function getRateToEth(address, bool) view returns (uint256)'], provider);

const rocketPoolId = '405159462932971535'
const broadcastChannelIds = [
  '704196071881965589', // general
  '405163713063288832', // trading
  '405503016234385409'  // random
]

const rateToString = r => {
  const rem = r % BigInt(1e12)
  return ethers.formatUnits(r - rem)
}

const waitBetweenCalls = 1500
const callQueue = []
async function rateLimit(getCall) {
  const waitTurn = new Promise(resolve => callQueue.push(resolve))
  if (callQueue.length) callQueue[0]()
  await waitTurn.then(() => callQueue.shift())
  await new Promise(resolve => setTimeout(resolve, waitBetweenCalls))
  if (callQueue.length) callQueue[0]()
  return await getCall()
}

async function oneInchSecondaryRate(addr) {
  const quoteParams = {
    src: addr,
    dst: ethAddress,
    amount: oneEtherStr
  }
  const queryString = new URLSearchParams(quoteParams).toString()
  const url = `https://api.1inch.dev/swap/v6.0/1/quote?${queryString}`
  const apiCall = () => new Promise((resolve, reject) => {
    const req = https.get(url, {headers: {'Authorization': `Bearer ${process.env.API_KEY}`}},
      (res) => {
        if (res.statusCode !== 200) {
          console.log(`${Date()}: Got ${res.statusCode} from 1inch: ${res.statusMessage}`)
          reject(res.statusMessage)
        }
        else {
          res.setEncoding('utf8')
          let data = ''
          res.on('data', (chunk) => data += chunk)
          res.on('end', () => resolve(JSON.parse(data)))
        }
      })
    req.on('error', reject)
  })
  const quote = await rateLimit(apiCall)
  return BigInt(quote.dstAmount)
}

async function cowSecondaryRate(addr) {
  const url = `https://api.cow.fi/mainnet/api/v1/token/${addr}/native_price`
  const options = {hedears: {'Accept': 'application/json'}}
  const apiCall = () => new Promise((resolve, reject) => {
    const req = https.get(url, options,
      (res) => {
        if (res.statusCode !== 200) {
          console.log(`${Date()}: Got ${res.statusCode} from CoW for ${url}: ${res.statusMessage}`)
          reject(res.statusMessage)
        }
        else {
          res.setEncoding('utf8')
          let data = ''
          res.on('data', (chunk) => data += chunk)
          res.on('end', () => resolve(JSON.parse(data)))
        }
      })
    req.on('error', reject)
  })
  const quote = await rateLimit(apiCall)
  return BigInt(quote.price * 10 ** 18)
}

const abs = (n) => n < 0n ? -n : n

const percentage = (p, s, addr) => {
  const d = p <= s ? ['premium', `${addr}/WETH`] :
                     ['discount', `WETH/${addr}`]
  return {
    'p': ethers.formatUnits(
      (abs(p - s) * 100n) * 1000n / p,
      3),
    'd': d[0],
    'u': d[1],
  }
}

const followupOptions = {
  headers: {
    'Authorization': `Bearer ${process.env.TOKEN}`,
    'User-Agent': `DiscordBot (https://xrchz.net/lsd-price, ${userAgentVersion})`,
    'Content-Type': 'application/json'
  },
  method: 'PATCH'
}

const secondaryRate = cowSecondaryRate

const protectPercentage = (rp, rs, addr) => {
  const r =
    (rp.status == 'fulfilled' && rs.status == 'fulfilled')
    ? percentage(rp.value, rs.value, addr)
    : {d: '?', u: `WETH/${addr}`, p: ''}
  r.pr =
    (rp.status == 'fulfilled')
    ? `${rateToString(rp.value)} ETH`
    : `error ${rp.reason}`
  r.sr =
    (rs.status == 'fulfilled')
    ? `${rateToString(rs.value)} ETH`
    : `error ${rs.reason}`
  return r
}

app.post('/', verifyKeyMiddleware(process.env.PUBLIC_KEY), (req, res) => {
  const interaction = req.body;
  const application_id = interaction.application_id
  const interaction_token = interaction.token
  const followupUrl = new URL(`${discordApi}/webhooks/${application_id}/${interaction_token}/messages/@original`)
  const suppress_embeds = true
  const ephemeral = interaction.guild_id === rocketPoolId && !broadcastChannelIds.includes(interaction.channel_id)
  const sendFollowup = msg => {
    const followupReq = https.request(followupUrl, followupOptions, followupRes => {
      if (followupRes.statusCode !== 200) {
        console.log(`Got ${followupRes.statusCode} from Discord: ${followupRes.statusMessage}`)
      }
    })
    followupReq.end(JSON.stringify({content: msg}))
  }
  if (interaction.type === InteractionType.APPLICATION_COMMAND) {
    res.send({
      type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
      content: 'Waiting for 1Inch...',
      flags: suppress_embeds<<2 | ephemeral<<6
    })
    Promise.allSettled(
      [rETHContract.getExchangeRate(),
        xrETHContract.convertToAssets(oneEther),
        wstETHContract.stEthPerToken(),
        swETHContract.swETHToETHRate(),
        cbETHContract.exchangeRate(),
        secondaryRate(rETHAddress),
        secondaryRate(xrETHAddress),
        secondaryRate(wstETHAddress),
        secondaryRate(swETHAddress),
        secondaryRate(cbETHAddress),
      ]).then(results => {
        const rETH = protectPercentage(results[0], results[5], rETHAddress)
        const xrETH = protectPercentage(results[1], results[6], xrETHAddress)
        const wstETH = protectPercentage(results[2], results[7], wstETHAddress)
        const swETH = protectPercentage(results[3], results[8], swETHAddress)
        const cbETH = protectPercentage(results[4], results[9], cbETHAddress)
        const lines = [
          '_Primary_',
          `**[1 rETH = ${rETH.pr}](<https://stake.rocketpool.net>)**`,
          `**[1 xrETH = ${xrETH.pr}](<https://app.gravitaprotocol.com/constellation/xreth>)**`,
          `**[1 wstETH = ${wstETH.pr}](<https://stake.lido.fi/wrap>)**`,
          `**[1 swETH = ${swETH.pr}](<https://app.swellnetwork.io>)**`,
          `**[1 cbETH = ${cbETH.pr}](<https://www.coinbase.com/cbeth/whitepaper>)**`,
          `_Secondary (CoW Protocol)_`,
          `**[1 rETH = ${rETH.sr}](<https://swap.cow.fi/#/1/swap/${rETH.u}>)** (${rETH.p}% ${rETH.d})`,
          `**[1 xrETH = ${xrETH.sr}](<https://swap.cow.fi/#/1/swap/${xrETH.u}>)** (${xrETH.p}% ${xrETH.d})`,
          `**[1 wstETH = ${wstETH.sr}](<https://swap.cow.fi/#/1/swap/${wstETH.u}>)** (${wstETH.p}% ${wstETH.d})`,
          `**[1 swETH = ${swETH.sr}](<https://swap.cow.fi/#/1/swap/${swETH.u}>)** (${swETH.p}% ${swETH.d})`,
          `**[1 cbETH = ${cbETH.sr}](<https://swap.cow.fi/#/1/swap/${cbETH.u}>)** (${cbETH.p}% ${cbETH.d})`,
          `_[bot](<https://github.com/xrchz/discord>) by ramana.eth (${truncatedAddress})_`,
        ]
        sendFollowup(lines.join('\n'))
      })
      .catch(error => {
        const message = ('statusMessage' in error) ? error.statusMessage : JSON.stringify(error)
        const shortMessage = message.length > 32 ? `${message.slice(0, 32)}...` : message
        sendFollowup(shortMessage)
      })
  }
});

const port = '/run/games/lsd.socket'

app.listen(port, () => {
  fs.chmodSync(port, 0o777);
  console.log(`LSD app listening on ${port}`);
});

process.on('SIGINT', () => { fs.unlinkSync(port); process.exit() })
