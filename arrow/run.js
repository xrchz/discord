import 'dotenv/config'
import express from 'express'
import * as https from 'https'
import { InteractionType, InteractionResponseType, verifyKeyMiddleware } from 'discord-interactions'
import * as fs from 'node:fs'

const app = express();

const discordApi = 'https://discord.com/api/v10'
const userAgentVersion = 1

const arrowServerId = '853833144037277726'
const nonBroadcastChannelIds = [ ]

const followupOptions = {
  headers: {
    'Authorization': `Bearer ${process.env.TOKEN}`,
    'User-Agent': `DiscordBot (https://xrchz.net/arrowbot/, ${userAgentVersion})`,
    'Content-Type': 'application/json'
  },
  method: 'PATCH'
}

app.post('/', verifyKeyMiddleware(process.env.PUBLIC_KEY), (req, res) => {
  const interaction = req.body;
  const application_id = interaction.application_id
  const interaction_token = interaction.token
  const followupUrl = new URL(`${discordApi}/webhooks/${application_id}/${interaction_token}/messages/@original`)
  const suppress_embeds = true
  const ephemeral = interaction.guild_id === arrowServerId && nonBroadcastChannelIds.includes(interaction.channel_id)
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
      content: 'Querying the oceans...',
      flags: suppress_embeds<<2 | ephemeral<<6
    })
    fetch(`https://api.vesselfinder.com/vessels?userkey=${process.env.API_KEY}&imo=9320453`).then(res => {
      if (res.status !== 200) {
        console.warn(`${Date()}: Vesselfinder returned ${res.status}`)
        throw res
      }
      return res.json().then(data => {
        const {AIS} = data
        const etastamp = Math.round(Date.parse(`${AIS.ETA.replace(' ', 'T')}Z`) / 1000)
        const lines = [
          `Vessel ${AIS.IMO}: ${AIS.NAME} (${AIS.CALLSIGN})`,
          `Current Position: ${AIS.LATITUDE}, ${AIS.LONGITUDE}`,
          `Estimated to reach ${AIS.DESTINATION}: ${AIS.ETA} (<t:${etastamp}:R>)`
        ]
        sendFollowup(lines.join('\n'))
      })
    }).catch(error => {
      const message = ('statusMessage' in error) ? error.statusMessage : JSON.stringify(error)
      console.warn(`${Date()}: error serving response: ${message}`)
      const shortMessage = message.length > 32 ? `${message.slice(0, 32)}...` : message
      sendFollowup(shortMessage)
    })
  }
});

const port = '/run/games/arrowbot.socket'

app.listen(port, () => {
  fs.chmodSync(port, 0o777);
  console.log(`Arrowbot app listening on ${port}`);
});

process.on('SIGINT', () => { fs.unlinkSync(port); process.exit() })
