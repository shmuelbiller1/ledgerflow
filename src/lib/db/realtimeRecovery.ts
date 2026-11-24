/**
 * F-13: the realtime library retries a healthy socket on its own, but a channel that reaches a failure state
 * (an error, a timeout, or closed by the server) would otherwise leave a list silently stale, because nothing
 * else triggers a read. Reloading at the moment of failure cannot see what other people changed *while the
 * socket was down*, so the catch-up reload runs when the channel is subscribed again. One reload on the way
 * down is still worth it (the read can fail for other reasons than the socket), but only once per outage,
 * never on each retry.
 */
export function reloadAfterOutage(reload: () => void): (status: unknown) => void {
  let channelDown = false;
  return status => {
    const state = String(status);
    if (state === 'CHANNEL_ERROR' || state === 'CLOSED' || state === 'TIMED_OUT') {
      if (!channelDown) { channelDown = true; reload(); }
    } else if (state === 'SUBSCRIBED' && channelDown) {
      channelDown = false; reload();
    }
  };
}
