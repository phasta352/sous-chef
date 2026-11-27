-- Saved recipes (from AI suggestions or imported from a website).
CREATE TABLE recipes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT NOT NULL,
  summary      TEXT,
  servings     TEXT,
  total_time   TEXT,
  ingredients  TEXT NOT NULL,                  -- JSON array of { name, amount }
  steps        TEXT NOT NULL,                  -- JSON array of strings
  source       TEXT NOT NULL DEFAULT 'ai',     -- 'ai' or 'url'
  source_url   TEXT,
  favorite     INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  created_by   TEXT
);

CREATE INDEX idx_recipes_favorite ON recipes (favorite);

-- Things to buy that aren't (yet) pantry items, e.g. missing recipe ingredients.
CREATE TABLE shopping_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  note        TEXT,                            -- e.g. "for Shakshuka"
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  created_by  TEXT
);
