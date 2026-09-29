// 写入串行化：同一时刻只有一个写事务，配合“先改内存再一次性落盘”，避免留半张单。
let tail = Promise.resolve();

export function runExclusive(task) {
  const result = tail.then(task, task);
  tail = result.then(
    () => {},
    () => {}
  );
  return result;
}
