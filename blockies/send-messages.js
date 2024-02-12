import 'dotenv/config'
import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
const icons = JSON.parse(readFileSync('icons.json'))
const outputs = []
for (const {user, name, addr, ens} of icons) {
  const json = JSON.stringify({
    embeds:[{title:`Address for ${name}`,
             description:`<@${user}>: ${addr}${ens ? ` (${ens})` : ''}`,
             url:`https://etherscan.io/address/${addr}`,
             image:{url:`attachment://${addr}.png`,height:32,width:32}}],
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
  outputs.push(res.stdout)
  await new Promise(resolve => setTimeout(resolve, 1000))
}
writeFileSync('responses.txt', outputs.join('\n'), {flag:'a'})
