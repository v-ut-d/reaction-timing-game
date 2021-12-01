-- CreateTable
CREATE TABLE "Point" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" TEXT NOT NULL,
    "point" INTEGER NOT NULL,
    "rawTimeNS" BIGINT NOT NULL,
    "gameId" INTEGER NOT NULL,
    "algorithmVersion" INTEGER NOT NULL,
    CONSTRAINT "Point_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Game" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "startedBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL,
    "startedAt" DATETIME,
    "finishedAt" DATETIME
);
