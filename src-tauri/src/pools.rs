use crate::task;
use std::sync::OnceLock;

static FILE_QUEUE_POOL: OnceLock<task::TaskPool> = OnceLock::new();

pub fn get_file_queue_pool() -> task::TaskPool {
    FILE_QUEUE_POOL
        .get_or_init(|| task::TaskPool::new())
        .clone()
}
