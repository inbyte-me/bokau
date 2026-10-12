CREATE TABLE `ai_calls` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`at` text NOT NULL,
	`model` text NOT NULL,
	`task` text,
	`cost_usd` real NOT NULL,
	`tokens` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `meta` (
	`key` text PRIMARY KEY,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`mode` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`document` text NOT NULL,
	`media` text,
	`stems` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `projects_updated_at_idx` ON `projects` (`updated_at`);