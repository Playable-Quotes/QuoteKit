let count = 0;
let start = null;

QuoteKit.addEventListener("main-loop", function () {
  if (count % 100 == 0) {
    if (start === null) start = Date.now();
    const now = Date.now();
    let avg = (now - start) / count;
    console.log("avg: " + avg + "ms");
  }
  count++;
});
