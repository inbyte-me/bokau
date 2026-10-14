CREATE TABLE `clip_owners` (
	`clip_id` text PRIMARY KEY,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`created_at` text NOT NULL,
	`last_seen_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `clip_owners_owner_idx` ON `clip_owners` (`owner_id`);