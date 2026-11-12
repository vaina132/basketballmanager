import { handleSeasonCodecRequest, type SeasonCodecReply, type SeasonCodecRequest } from './season-codec'

// Strict save validation runs here so a long career never freezes the interface while saving or loading.
const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<SeasonCodecRequest>) => void) | null
  postMessage: (reply: SeasonCodecReply) => void
}
scope.onmessage = ({ data }) => scope.postMessage(handleSeasonCodecRequest(data))
