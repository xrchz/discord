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

const MAX_MAPS = 12
const maps = new Map()

async function ensureMap(coords) {
  if (maps.has(coords)) {
    console.log(`${Date()}: map cache hit for ${coords}`)
    return
  }
  console.log(`${Date()}: fetching map for ${coords}`)
  const res = await fetch(`https://maps.googleapis.com/maps/api/staticmap?key=${process.env.MAPS_API_KEY}&size=256x256&maptype=hybrid&markers=label:ROSARIA|${coords}`)
  if (res.status !== 200) {
    const error = `${res.status}: ${await res.text()}`
    console.warn(`${Date()}: Maps returned ${error}`)
    throw {statusMessage: error}
  }
  const buffer = Buffer.from(await res.arrayBuffer())
  console.log(`Got map of ${buffer.length} bytes for ${coords}`)
  maps.set(coords, buffer)
  if (maps.size > MAX_MAPS) {
    const key = maps.keys().next().value
    console.log(`${Date()}: deleting ${key} from cache`)
    maps.delete(key)
  }
}

app.get('/map/:coords([-+0-9.,]{3,}).png', (req, res) => {
  if (!maps.has(req.params.coords)) {
    console.warn(`${Date()}: map cache miss for ${req.params.coords}`)
    return res.status(404).end()
  }
  const buffer = maps.get(req.params.coords)
  res.type('png')
  res.send(buffer)
})

app.get('*', (req, res, next) => {
  console.warn(`${Date()}: unexpected GET path ${req.path}`)
  next()
})

app.post('/', verifyKeyMiddleware(process.env.PUBLIC_KEY), (req, res) => {
  const interaction = req.body;
  const application_id = interaction.application_id
  const interaction_token = interaction.token
  const followupUrl = new URL(`${discordApi}/webhooks/${application_id}/${interaction_token}/messages/@original`)
  const suppress_embeds = true
  const ephemeral = interaction.guild_id === arrowServerId && nonBroadcastChannelIds.includes(interaction.channel_id)
  const sendFollowup = ({content, embeds}) => {
    const followupReq = https.request(followupUrl, followupOptions, followupRes => {
      if (followupRes.statusCode !== 200) {
        console.log(`Got ${followupRes.statusCode} from Discord: ${followupRes.statusMessage}`)
      }
    })
    followupReq.end(JSON.stringify({content, embeds}))
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
        const {AIS} = data[0]
        const etastamp = Math.round(Date.parse(`${AIS.ETA.replace(' ', 'T')}Z`) / 1000)
        const {LATITUDE, LONGITUDE} = AIS
        const coords = `${LATITUDE},${LONGITUDE}`
        return ensureMap(coords).then(() => {
          const lines = [
            `Vessel ${AIS.IMO}: ${AIS.NAME} (${AIS.CALLSIGN})`,
            `Current Position: ${LATITUDE}, ${LONGITUDE}`,
            `Speed: ${AIS.SPEED} knots`,
            `Estimated to reach ${AIS.DESTINATION}: ${AIS.ETA} (<t:${etastamp}:R>)`
          ]
          sendFollowup({content: lines.join('\n'), embeds: [{image:{url:`https://xrchz.net/arrowbot/map/${coords}.png`}}]})
        })
      })
    }).catch(error => {
      const message = ('statusMessage' in error) ? error.statusMessage : JSON.stringify(error)
      console.warn(`${Date()}: error ${error}:${typeof error} serving response: ${message}`)
      const shortMessage = message.length > 32 ? `${message.slice(0, 32)}...` : message
      sendFollowup({content: shortMessage})
    })
  }
});

const port = '/run/games/arrowbot.socket'

app.listen(port, () => {
  fs.chmodSync(port, 0o777);
  console.log(`Arrowbot app listening on ${port}`);
});

process.on('SIGINT', () => { fs.unlinkSync(port); process.exit() })
