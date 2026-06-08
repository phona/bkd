CREATE TABLE `issue_projects` (
	`id` text PRIMARY KEY NOT NULL,
	`issue_id` text NOT NULL,
	`project_id` text NOT NULL,
	`is_primary` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`is_deleted` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `issue_projects_issue_id_project_id_uniq` ON `issue_projects` (`issue_id`,`project_id`);--> statement-breakpoint
CREATE INDEX `issue_projects_issue_id_idx` ON `issue_projects` (`issue_id`);