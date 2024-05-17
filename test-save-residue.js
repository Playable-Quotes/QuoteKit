const start = Date.now();
const residue = QuoteKit.saveResidue();
const now = Date.now();

console.log(
  "save_residue: " + (now - start) + "ms" + " " + residue.byteLength + " bytes"
);

File.writeAllBytes("./current_savestate", residue);
