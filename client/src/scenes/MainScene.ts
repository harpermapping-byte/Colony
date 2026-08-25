import Phaser from "phaser";
import { Client, Room, getStateCallbacks } from "colyseus.js";
import { SERVER_URL } from "../config";

interface Direction {
  x: number;
  y: number;
}

// Escena minima: conecta a la sala "hub", crea un sprite placeholder por
// cada jugador presente en el estado del servidor y lo mueve cuando el
// servidor manda una nueva posicion. El input solo se manda cuando cambia
// de direccion (no cada frame) para ahorrar ancho de banda.
export class MainScene extends Phaser.Scene {
  private room?: Room;
  private avatars = new Map<string, Phaser.GameObjects.Container>();
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private lastSentDir: Direction = { x: 0, y: 0 };

  constructor() {
    super("main");
  }

  preload() {
    // placeholder grafico: circulo generado en runtime, sin sprites de arte todavia
    const gfx = this.make.graphics({}, false);
    gfx.fillStyle(0x4fd1c5, 1);
    gfx.fillCircle(16, 16, 16);
    gfx.generateTexture("player-placeholder", 32, 32);
    gfx.destroy();
  }

  async create() {
    this.keys = this.input.keyboard!.addKeys("W,A,S,D,UP,LEFT,DOWN,RIGHT") as Record<
      string,
      Phaser.Input.Keyboard.Key
    >;

    const client = new Client(SERVER_URL);
    this.room = await client.joinOrCreate("hub", {
      name: `Viewer-${Math.floor(Math.random() * 1000)}`,
    });

    const $ = getStateCallbacks(this.room);

    $(this.room.state).players.onAdd((player: any, sessionId: string) => {
      const isSelf = sessionId === this.room?.sessionId;

      const container = this.add.container(player.x, player.y);
      const sprite = this.add.image(0, 0, "player-placeholder");
      if (isSelf) sprite.setTint(0xf6ad55);

      const label = this.add
        .text(0, -24, player.name, { fontSize: "12px", color: "#ffffff" })
        .setOrigin(0.5, 0.5);

      container.add([sprite, label]);
      this.avatars.set(sessionId, container);

      $(player).onChange(() => {
        container.setPosition(player.x, player.y);
      });
    });

    $(this.room.state).players.onRemove((_player: any, sessionId: string) => {
      this.avatars.get(sessionId)?.destroy();
      this.avatars.delete(sessionId);
    });
  }

  update() {
    if (!this.room) return;

    const x =
      (this.keys.D?.isDown || this.keys.RIGHT?.isDown ? 1 : 0) -
      (this.keys.A?.isDown || this.keys.LEFT?.isDown ? 1 : 0);
    const y =
      (this.keys.S?.isDown || this.keys.DOWN?.isDown ? 1 : 0) -
      (this.keys.W?.isDown || this.keys.UP?.isDown ? 1 : 0);

    if (x !== this.lastSentDir.x || y !== this.lastSentDir.y) {
      this.lastSentDir = { x, y };
      this.room.send("input", this.lastSentDir);
    }
  }
}
