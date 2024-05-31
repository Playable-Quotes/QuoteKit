/*
This API is meant to be implemented in an environment like the browser where the code is executed inside the same process that hosts the actual emulator and events as dispatched synchronously (e.g. the state is not changing during the saving of a residue).

Methods:
    getDeviceInfo() -> Empty obj
    setEmulator(v86Emulator)
    mainLoop()
    saveResidue() -> ArrayBuffer
    residueLoop()
Events:
    None currently

*/

(function () {
  "use strict";
  const eventTarget = new EventTarget();
  let emulator;

  function getDeviceInfo() {
    return {};
  }

  function setEmulator(v86Emulator) {
    emulator = v86Emulator;
  }

  function mainLoop() {
    console.log("Emulator has started");
    let old_do_tick = emulator.v86.do_tick;
    let count = 0;
    let start = null;
    const new_do_tick = function () {
      if (start == null) start = Date.now();
      old_do_tick.call(emulator.v86);
      const now = Date.now();
      const avg = (now - start) / count++;
      console.log("avg: " + avg + "ms");
    };
    emulator.v86.do_tick = new_do_tick;
  }

  async function saveResidue() {
    let cpu_pack_memory = emulator.v86.cpu_pack_memory;
    emulator.v86.cpu.pack_memory = function () {
      let packed_memory = new Uint8Array(0);
      let bitmap = {
        get_buffer() {
          return new Uint8Array(0);
        },
      };
      return { packed_memory, bitmap };
    };

    let hda_get_state = emulator.v86.cpu.devices.hda.get_state;
    emulator.v86.cpu.devices.hda.get_state = function () {
      let state = hda_get_state.call(this);
      state[0] = Object.assign({ get_state: state[0].get_state }, state[0]);
      state[1] = Object.assign({ get_state: state[1].get_state }, state[1]);
      state[0].buffer = new Uint8Array(0);
      state[1].buffer = new Uint8Array(0);
      return state;
    };

    let vga_get_state = emulator.v86.cpu.devices.vga.get_state;
    emulator.v86.cpu.devices.vga.get_state = function () {
      let state = vga_get_state.call(this);
      window.temp1 = state[39].buffer;
      state[39] = new Uint8Array(0);
      return state;
    };

    let residue = await emulator.save_state();

    emulator.v86.cpu.devices.vga.get_state = vga_get_state;
    emulator.v86.cpu.devices.hda.get_state = hda_get_state;
    emulator.v86.cpu.pack_memory = cpu_pack_memory;

    return residue;
  }

  function residueLoop() {
    let old_do_tick = emulator.v86.do_tick;
    let count = 0;
    let start = null;
    const new_do_tick = function () {
      if (start === null) start = Date.now();
      old_do_tick.call(emulator.v86);
      saveResidue();
      const now = Date.now();
      const avg = (now - start) / count++;
      console.log("avg: " + avg + "ms");
    };
    emulator.v86.do_tick = new_do_tick;
  }

  globalThis.QuoteKit = {
    addEventListener: eventTarget.addEventListener.bind(eventTarget),
    removeEventListener: eventTarget.removeEventListener.bind(eventTarget),
    getDeviceInfo,
    setEmulator,
    mainLoop,
    saveResidue,
    residueLoop,
  };
})();
