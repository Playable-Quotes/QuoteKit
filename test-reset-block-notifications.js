QuoteKit.addEventListener("read-block", (event) => {
  console.log(`Read block: ${JSON.stringify(event, null, 2)}`);
});

QuoteKit.addEventListener("write-block", (event) => {
  console.log(`Write block: ${JSON.stringify(event, null, 2)}`);
});

setInterval(() => {
  QuoteKit.resetBlockNotifications();
}, 1000);
