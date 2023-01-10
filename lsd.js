require('dotenv').config()

const fs = require('fs')
const ethers = require('ethers')
const express = require('express')
const https = require('https')
const { InteractionType, InteractionResponseType, verifyKeyMiddleware } = require('discord-interactions')

const app = express();

const provider = ethers.getDefaultProvider('mainnet', {
  'etherscan': process.env.ETHERSCAN_KEY,
  'pocket': process.env.POCKET_KEY,
});
const ramanaAddressOneInch = '0xB0De8cB8Dcc8c5382c4b7F3E978b491140B2bC55';
const ramanaAddress = '0x65FE89a480bdB998F4116DAf2A9360632554092c';
const truncatedAddress = `${ramanaAddress.substring(0,6)}…${ramanaAddress.substring(ramanaAddress.length - 4)}`
const oneEtherStr = ethers.utils.parseUnits('1', 'ether').toString();
const ethAddress = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const rETHAddress = '0xae78736Cd615f374D3085123A210448E74Fc6393';
const wstETHAddress = '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0';
const cbETHAddress = '0xbe9895146f7af43049ca1c1ae358b0541ea49704';
const rETHContract = new ethers.Contract(rETHAddress,
  ['function getExchangeRate() view returns (uint256)'], provider);
const wstETHContract = new ethers.Contract(wstETHAddress,
  ['function stEthPerToken() view returns (uint256)'], provider);
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
  const rem = r.mod(1e12)
  return ethers.utils.formatUnits(r.sub(rem))
}

// const secondaryRate = addr => spotPriceContract.getRateToEth(addr, true);

async function secondaryRate(addr) {
  const quoteParams = {
    fromTokenAddress: addr,
    toTokenAddress: ethAddress,
    amount: oneEtherStr
  }
  const queryString = new URLSearchParams(quoteParams).toString()
  const url = `https://api.1inch.io/v5.0/1/quote?${queryString}`
  const apiCall = new Promise((resolve, reject) => {
    const req = https.get(url,
      (res) => {
        if (res.statusCode !== 200) {
          console.log(`Got ${res.statusCode} from 1inch: ${res.statusMessage}`)
          reject(res)
        }
        res.setEncoding('utf8')
        let data = ''
        res.on('data', (chunk) => data += chunk)
        res.on('end', () => resolve(JSON.parse(data)))
      })
    req.on('error', reject)
  })
  const quote = await apiCall
  return ethers.BigNumber.from(quote.toTokenAmount)
}

const percentage = (p, s, addr) => {
  const d = p.lte(s) ? ['premium', `${addr}/WETH`] :
                       ['discount', `WETH/${addr}`]
  return {
    'p': ethers.utils.formatUnits(
      ((p.sub(s).abs()).mul('100')).mul('1000').div(p),
      3),
    'd': d[0],
    'u': d[1],
  }
}

app.post('/', verifyKeyMiddleware(process.env.PUBLIC_KEY), (req, res) => {
  const interaction = req.body;
  if (interaction.type === InteractionType.APPLICATION_COMMAND) {
    Promise.all(
      [rETHContract.getExchangeRate(),
       wstETHContract.stEthPerToken(),
       cbETHContract.exchangeRate(),
       secondaryRate(rETHAddress),
       secondaryRate(wstETHAddress),
       secondaryRate(cbETHAddress)]).then(prices => {
          const rETH = percentage(prices[0], prices[3], rETHAddress)
          const wstETH = percentage(prices[1], prices[4], wstETHAddress)
          const cbETH = percentage(prices[2], prices[5], cbETHAddress)
          const lines = [
            '_Primary_',
            `**[1 rETH = ${rateToString(prices[0])} ETH](https://stake.rocketpool.net)**`,
            `**[1 wstETH = ${rateToString(prices[1])} ETH](https://stake.lido.fi/wrap)**`,
            `**[1 cbETH = ${rateToString(prices[2])} ETH](https://www.coinbase.com/cbeth/whitepaper)**`,
            // 'Warning: these are liquidity-weighted average prices, not best prices. Will switch to best at some point.',
            `_Secondary ([1Inch](https://app.1inch.io/#/r/${ramanaAddressOneInch}))_`,
            `**[1 rETH = ${rateToString(prices[3])} ETH](https://app.1inch.io/#/1/classic/limit-order/${rETH.u})** (${rETH.p}% ${rETH.d})`,
            `**[1 wstETH = ${rateToString(prices[4])} ETH](https://app.1inch.io/#/1/classic/limit-order/${wstETH.u})** (${wstETH.p}% ${wstETH.d})`,
            `**[1 cbETH = ${rateToString(prices[5])} ETH](https://app.1inch.io/#/1/classic/limit-order/${cbETH.u})** (${cbETH.p}% ${cbETH.d})`,
            `_[bot](https://github.com/xrchz/discord) by ramana.eth (${truncatedAddress})_`,
          ]
          const suppress_embeds = true
          const ephemeral = interaction.guild_id === rocketPoolId && !broadcastChannelIds.includes(interaction.channel_id)
          res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content: lines.join('\n'),
              flags: suppress_embeds<<2 | ephemeral<<6,
            },
          });
        })
  }
});

const port = '/run/games/lsd.socket'

app.listen(port, () => {
  fs.chmodSync(port, 0o777);
  console.log(`LSD app listening on ${port}`);
});

process.on('SIGINT', () => { fs.unlinkSync(port); process.exit() })
