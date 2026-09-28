// A small pool for the decodes a LIST asks for — covers, thumbnails — bounded
// in how many run at once, and newest first. Port of
// `src/shared/lib/decode-queue.ts`.
//
// A scroll over a folder of two hundred photographs used to start two hundred
// decodes in the same second, each holding a full-size bitmap until its
// thumbnail was drawn. A pool of a few slots caps that. Newest FIRST because
// the rows most recently scrolled into view are the ones on screen: a
// first-in queue would draw the covers the reader has already scrolled past
// before the ones under the pointer.
//
// The web's `task` returns a Promise; here a task is handed a `settle` closure
// it calls exactly once with its result (a second call is ignored). The slot
// is freed and the next task STARTED before the caller's completion runs — the
// web's rule, so a completion that enqueues sees a current count. Pure, no
// platform: the queue owns no thread; a task runs wherever `start` is called,
// and `settle` may be called from any thread — the counts are guarded.

import Foundation

public enum DecodeQueueError: Error, Equatable {
    /// `makeDecodeQueue(0)` — a pool needs at least one slot.
    case noSlot
}

public final class DecodeQueue {
    /// What a task calls, once, when it has its result.
    public typealias Settle<T> = (Result<T, Error>) -> Void

    private let slots: Int
    private let lock = NSLock()
    private var runningCount = 0
    private var pending: [() -> Void] = []

    public init(slots: Int) throws {
        guard slots >= 1 else { throw DecodeQueueError.noSlot }
        self.slots = slots
    }

    /// How many tasks are running right now.
    public var running: Int {
        lock.lock()
        defer { lock.unlock() }
        return runningCount
    }

    /// How many tasks are waiting for a slot.
    public var waiting: Int {
        lock.lock()
        defer { lock.unlock() }
        return pending.count
    }

    /// Run `task` when a slot is free; `completion` gets its result.
    public func enqueue<T>(_ task: @escaping (@escaping Settle<T>) -> Void,
                           completion: @escaping Settle<T>) {
        let start: () -> Void = { [weak self] in
            guard let self else { return }
            var settled = false
            // The slot is freed in the SAME call that settles the caller, so
            // the next task has started by the time anyone waiting on this
            // one continues — a release a tick later showed a stale count.
            let settle: Settle<T> = { result in
                self.lock.lock()
                if settled {
                    self.lock.unlock()
                    return
                }
                settled = true
                self.runningCount -= 1
                self.lock.unlock()
                self.next()
                completion(result)
            }
            task(settle)
        }
        lock.lock()
        pending.append(start)
        lock.unlock()
        next()
    }

    private func next() {
        while true {
            lock.lock()
            // Newest first: what just scrolled into view is what is on screen.
            guard runningCount < slots, let start = pending.popLast() else {
                lock.unlock()
                return
            }
            runningCount += 1
            lock.unlock()
            start()
        }
    }
}

/// The web's factory: a queue of `slots`, or `DecodeQueueError.noSlot`.
public func makeDecodeQueue(_ slots: Int) throws -> DecodeQueue {
    try DecodeQueue(slots: slots)
}
