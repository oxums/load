use std::sync::{
    mpsc::{self, Receiver, Sender},
    Arc, Mutex,
};

#[derive(Clone)]
pub struct TaskPool {
    tasks: Arc<Mutex<Vec<String>>>,
    notifier: Sender<()>,
    receiver: Arc<Mutex<Receiver<()>>>,
}

impl TaskPool {
    pub fn new() -> Self {
        let (tx, rx) = mpsc::channel();
        Self {
            tasks: Arc::new(Mutex::new(Vec::new())),
            notifier: tx,
            receiver: Arc::new(Mutex::new(rx)),
        }
    }

    pub fn add_task(&self, task: String) {
        let mut tasks = self.tasks.lock().unwrap();
        tasks.push(task);
        let _ = self.notifier.send(());
    }

    pub fn fetch_tasks(&self) -> Vec<String> {
        let mut tasks = self.tasks.lock().unwrap();
        tasks.drain(..).collect()
    }

    pub fn wait_for_task(&self) {
        let rx = self.receiver.lock().unwrap();
        rx.recv().expect("Failed to receive task event");
    }
}
