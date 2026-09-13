export async function deliverNightlyNotification(
  send: () => Promise<boolean>,
  recordFailure: (message: string) => void,
): Promise<boolean> {
  let sent = false;
  try {
    sent = await send();
  } catch {
    recordFailure('Nightly Telegram delivery threw an error; inspect the delivery logs.');
    return false;
  }
  if (!sent) {
    recordFailure('Nightly Telegram summary was not delivered; inspect configuration and delivery logs.');
  }
  return sent;
}