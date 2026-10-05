/**
 * When `on`, balls and tables are built without meshes even in a browser.
 * The match engine sets it around its own simulations so that running them
 * on a page does not create view objects for every shot.
 */
export const Headless = { on: false }
