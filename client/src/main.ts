import Phaser from "phaser";
import { MainScene } from "./scenes/MainScene";

new Phaser.Game({
  type: Phaser.AUTO,
  width: 800,
  height: 600,
  backgroundColor: "#1a202c",
  parent: "app",
  scene: [MainScene],
});
