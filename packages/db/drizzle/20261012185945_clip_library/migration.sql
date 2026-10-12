ALTER TABLE `projects` ADD `template` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `source_template_id` text;--> statement-breakpoint
CREATE INDEX `projects_template_idx` ON `projects` (`template`);