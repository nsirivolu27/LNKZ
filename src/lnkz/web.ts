import express, { type Express } from "express";
import { resolve } from "node:path";

export function mountWebRoutes(app: Express, directory = "dist/web"): void {
  const root = resolve(directory);
  // Only the built entry points and assets are public; API misses stay JSON.
  app.use("/assets", express.static(resolve(root, "assets"), { index: false, dotfiles: "deny" }));
  for (const [path, file] of [["/", "index.html"], ["/console.html", "console.html"]]) {
    app.get(path, (_request, response, next) => {
      response.setHeader("cache-control", "no-cache");
      response.sendFile(file, { root, dotfiles: "deny" }, (error) => {
        if (!error) return;
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          next();
          return;
        }
        next(error);
      });
    });
  }
}
