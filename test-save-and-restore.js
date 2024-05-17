function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  await delay(2000);

  const start = Date.now();
  const residue = QuoteKit.saveResidue();
  console.log(
    "save_residue: " +
      residue.byteLength +
      " bytes - in " +
      (Date.now() - start) +
      "ms"
  );

  await delay(6000);

  const start2 = Date.now();
  QuoteKit.restoreResidue(residue);
  console.log(
    "restore_residue: " +
      residue.byteLength +
      " bytes - in " +
      (Date.now() - start2) +
      "ms"
  );
}

main();
