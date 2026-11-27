-- How many of each item there is. 0 means "don't have". in_stock is kept in sync for older code.
ALTER TABLE items ADD COLUMN quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 0);
UPDATE items SET quantity = CASE WHEN in_stock = 1 THEN 1 ELSE 0 END;
