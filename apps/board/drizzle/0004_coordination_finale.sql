CREATE TABLE `challenge_dependencies` (
	`challenge_id` text PRIMARY KEY NOT NULL,
	`depends_on_squad_id` text NOT NULL,
	`kind` text DEFAULT 'neighbor_crisis' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`challenge_id`) REFERENCES `challenges`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`depends_on_squad_id`) REFERENCES `squads`(`id`) ON UPDATE no action ON DELETE no action
);

CREATE TABLE `orchestrator_model_handoffs` (
	`sequence` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL UNIQUE,
	`participant_id` text NOT NULL,
	`model_label` text NOT NULL,
	`previous_model_label` text NOT NULL,
	`handoff` text NOT NULL,
	`actor_person_id` text NOT NULL,
	`actor_name` text NOT NULL,
	`round_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`consumed_at` text,
	FOREIGN KEY (`actor_person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`round_id`) REFERENCES `rounds`(`id`) ON UPDATE no action ON DELETE no action
);

CREATE INDEX `orchestrator_model_handoffs_created_idx` ON `orchestrator_model_handoffs` (`created_at`);
