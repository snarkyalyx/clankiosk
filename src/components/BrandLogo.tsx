import openai from '../assets/logos/openai-ui.svg'
import anthropic from '../assets/logos/anthropic-ui.svg'
import ollama from '../assets/logos/ollama-ui.svg'
import commandcode from '../assets/logos/commandcode-ui.svg'
import xai from '../assets/logos/xai-ui.svg'
import stepfun from '../assets/logos/stepfun-ui.svg'
import xiaomi from '../assets/logos/xiaomi-ui.svg'
import apple from '../assets/logos/apple.svg'
import linux from '../assets/logos/linux.svg'

const logos: Record<string, string> = { codex:openai, openai, anthropic, claude:anthropic, ollama, 'ollama-cloud':ollama, 'command-code':commandcode, xai, stepfun, xiaomi, mimo:xiaomi }
export function ProviderLogo({ id }: { id:string }) {
  const src = logos[id.replace(/-\d+$/, '')]
  return src ? <span className="brand-logo provider-logo" aria-hidden="true" style={{ maskImage:`url("${src}")` }} /> : null
}
export function DeviceLogo({ origin }: { origin?:string }) {
  if (!origin) return null
  const isMac = origin.toLowerCase() === 'mac', isLinux = origin.toLowerCase() === 'fag' || origin.toLowerCase() === 'linux'
  if (!isMac && !isLinux) return <span className="device-name quiet">{origin}</span>
  return <span className="brand-logo device-logo" role="img" aria-label={isMac ? 'Mac' : 'Linux'} title={isMac ? 'Mac' : 'Linux'} style={{ maskImage:`url("${isMac ? apple : linux}")` }} />
}
