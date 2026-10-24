ALTER TABLE app_preferences
ADD COLUMN wallet_suggestion_expiry_days INTEGER NOT NULL DEFAULT 7
CHECK (wallet_suggestion_expiry_days >= 1);
