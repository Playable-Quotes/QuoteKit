/*
This API is meant to be implemented in an environment like Frida or the browser where the code is executed inside the same process that hosts the actual emulator and events as dispatched synchronously (e.g. the state is not changing during the saving of a residue).

Methods:
    *getDeviceInfo() -> obj containing name, block size, and block count for devices
    *saveResidue() -> ArrayBuffer
    *restoreResidue(buffer)
    readBlock(device,index) -> ArrayBuffer
    writeBlock(device,index,buffer)
    resetBlockNotifications()
    applyStimulus(obj)
Events:
    *main-loop: details nothing
    frame: visual animation frame, details pixels
    read-block: details device id and block index
    write-block: details device id and block index
    *stimulus: details an environmental stimulus object

*/

(function () {
  "use strict";
  class EventTarget {
    constructor() {
      this.listeners = {};
    }
    addEventListener(type, listener) {
      if (!(type in this.listeners)) {
        this.listeners[type] = [];
      }
      this.listeners[type].push(listener);
    }
    removeEventListener(type, listener) {
      if (!(type in this.listeners)) {
        return;
      }
      const index = this.listeners[type].indexOf(listener);
      if (index !== -1) {
        this.listeners[type].splice(index, 1);
      }
    }
    dispatchEvent(event) {
      if (!(event.type in this.listeners)) {
        return;
      }
      for (let listener of this.listeners[event.type]) {
        listener.call(this, event);
      }
    }
  }

  // save residue ----------------------------------------------

  function saveResidue() {
    let retro_serialize_size_addr = DebugSymbol.fromName(
      "retro_serialize_size"
    ).address;
    let retro_serialize_addr = DebugSymbol.fromName("retro_serialize").address;

    const retro_serialize_size = new NativeFunction(
      retro_serialize_size_addr,
      "size_t",
      []
    );
    const retro_serialize = new NativeFunction(retro_serialize_addr, "bool", [
      "pointer",
      "size_t",
    ]);

    const size = retro_serialize_size();
    const dataPointer = Memory.alloc(size);
    retro_serialize(dataPointer, size);
    return dataPointer.readByteArray(size);
  }

  // restore residue ----------------------------------------------

  function restoreResidue(buffer) {
    let retro_unserialize_addr =
      DebugSymbol.fromName("retro_unserialize").address;

    const retro_unserialize = new NativeFunction(
      retro_unserialize_addr,
      "bool",
      ["pointer", "size_t"]
    );

    const dataPointer = Memory.alloc(buffer.byteLength);
    dataPointer.writeByteArray(buffer);
    return retro_unserialize(dataPointer, buffer.byteLength);
  }

  // stimulus ----------------------------------------------

  Interceptor.attach(
    DebugSymbol.fromName("input_driver_state_wrapper").address,
    {
      onEnter(args) {
        const port = args[0].toInt32();
        const device = args[1].toInt32();
        const index = args[2].toInt32();
        const id = args[3].toInt32();

        this.event = {
          type: "stimulus",
          port,
          device,
          index,
          id,
        };
      },
      onLeave(retval) {
        this.event.retval = retval.toInt32();
        eventTarget.dispatchEvent(this.event);
      },
    }
  );

  // device info ----------------------------------------------

  function getDeviceInfo() {
    return {
      ram: {
        name: "RAM",
        block_size: memory_block_size,
        block_count: num_memory_blocks,
      },
      rom: {
        name: "ROM",
        block_size: -1,
        block_count: -1,
      },
    };
  }

  // main loop ----------------------------------------------

  const eventTarget = new EventTarget();

  const funcAddr = DebugSymbol.fromName("retro_run").address;
  Interceptor.attach(funcAddr, function () {
    eventTarget.dispatchEvent({ type: "main-loop" });
  });

  // reset block notifications ----------------------------------------------

  const RETRO_MEMORY_SYSTEM_RAM = 2;
  const get_mem_size = new NativeFunction(
    DebugSymbol.fromName("retro_get_memory_size").address,
    "size_t",
    ["int"]
  );
  const get_mem_data = new NativeFunction(
    DebugSymbol.fromName("retro_get_memory_data").address,
    "pointer",
    ["int"]
  );

  const mem_data = get_mem_data(RETRO_MEMORY_SYSTEM_RAM);
  const mem_size = get_mem_size(RETRO_MEMORY_SYSTEM_RAM).toNumber();

  const memory_block_size = Process.pageSize;
  const num_memory_blocks = mem_size / memory_block_size;

  Process.setExceptionHandler(function (details) {
    if (details.type === "access-violation") {
      if (details.memory.operation === "read") {
        const addr = details.memory.address;
        Memory.protect(addr, 1, "rw-");

        eventTarget.dispatchEvent({
          type: "read-block",
          device: "memory",
          index: Math.floor(addr.sub(mem_data).toInt32() / memory_block_size),
        });
        return true;
      }
      if (details.memory.operation === "write") {
        const addr = details.memory.address;
        Memory.protect(addr, 1, "rw-");
        eventTarget.dispatchEvent({
          type: "write-block",
          device: "memory",
          index: Math.floor(addr.sub(mem_data).toInt32() / memory_block_size),
        });
        return true;
      }
    }
    return false;
  });

  Memory.protect(mem_data, mem_size, "---");

  function resetMemoryBlockNotifications() {
    Memory.protect(mem_data, mem_size, "---");
  }

  function resetBlockNotifications() {
    resetMemoryBlockNotifications();
  }

  globalThis.QuoteKit = {
    addEventListener: eventTarget.addEventListener.bind(eventTarget),
    removeEventListener: eventTarget.removeEventListener.bind(eventTarget),
    getDeviceInfo,
    saveResidue,
    restoreResidue,
    resetBlockNotifications,
  };

  console.log("QuoteKit initialized");
})();
