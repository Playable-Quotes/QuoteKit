/*
This API is meant to be implemented in an environment like the browser where the code is executed inside the same process that hosts the actual emulator and events as dispatched synchronously (e.g. the state is not changing during the saving of a residue).

Methods:
    getDeviceInfo() -> obj containing name, block size, and block count for devices (currently does nothing)
    saveResidue() -> ArrayBuffer
    restoreResidue(buffer)
    readBlock(device,index) -> ArrayBuffer
    writeBlock(device,index,buffer)
    resetBlockNotifications()
    applyStimulus(obj)
Events:
    main-loop: details nothing
    frame: visual animation frame, details pixels
    read-block: details device id and block index
    write-block: details device id and block index
    stimulus: details an environmental stimulus object

*/

(function () {
  "use strict";
  const eventTarget = new EventTarget();

  let emulator;

  const DISK_PAGE_SIZE = 1024 * 4;

  const allowedDiskPages = new Set();

  const original_create_memory = CPU.prototype.create_memory;

  function getDeviceInfo() {
    return {};
  }

  function setup(v86Emulator) {
    emulator = v86Emulator;
    CPU.prototype.codegen_finalize = function () {}; // block jit
    const old_get = emulator.disk_images.hda.get;
    emulator.disk_images.hda.get = function get(start, len, fn) {
      disk_get(start, len);
      return old_get.bind(this)(start, len, fn);
    }
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

  function disk_get(start, len) {
    const pageStart = (start / DISK_PAGE_SIZE) | 0;
    for (let i = 0; i < len; i += DISK_PAGE_SIZE) {
      const page = pageStart + i / DISK_PAGE_SIZE;
      if (!allowedDiskPages.has(page)) {
        allowedDiskPages.add(page);
        console.log("disk get: ", page);
      }
    }
  }

  CPU.prototype.create_memory = function (size) {
    const original_allocate_memory = this.allocate_memory;
    this.allocate_memory = function (size) {
      const ptr = original_allocate_memory(size);
      pmemStart = ptr;
      pmemLength = size;
      console.log("buffer found");
      return ptr;
    };
    original_create_memory.bind(this)(size);
  };

  globalThis.QuoteKit = {
    addEventListener: eventTarget.addEventListener.bind(eventTarget),
    removeEventListener: eventTarget.removeEventListener.bind(eventTarget),
    getDeviceInfo,
    setup,
    mainLoop,
    saveResidue,
    residueLoop,
    disk_get,
  };
})();
