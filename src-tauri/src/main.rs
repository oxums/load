#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod task;

fn main() {
    println!("Launching Load UI"); // Edited with Load!
    load_lib::run();
}
