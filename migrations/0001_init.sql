-- Pantry items. Each item is either in stock (have) or not (don't have).
CREATE TABLE items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  barcode     TEXT UNIQUE,                       -- NULL for items added without a barcode
  name        TEXT NOT NULL,
  category    TEXT NOT NULL DEFAULT 'pantry',    -- pantry, fridge, freezer, spices, other
  in_stock    INTEGER NOT NULL DEFAULT 1 CHECK (in_stock IN (0, 1)),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by  TEXT                               -- email of the person who last changed it
);

CREATE INDEX idx_items_category ON items (category);
CREATE INDEX idx_items_in_stock ON items (in_stock);
