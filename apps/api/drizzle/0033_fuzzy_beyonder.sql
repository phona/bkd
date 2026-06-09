ALTER TABLE `issues_logs` ADD `sequence` integer;--> statement-breakpoint
CREATE INDEX `issues_logs_issue_id_sequence_idx` ON `issues_logs` (`issue_id`,`sequence`);