#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod task;

fn main() {
    load_lib::run()
}
