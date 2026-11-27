CREATE TABLE `stock_transfer_lines` (
	`id` char(36) NOT NULL,
	`company_id` char(36) NOT NULL,
	`transfer_id` char(36) NOT NULL,
	`item_id` char(36) NOT NULL,
	`line_no` int NOT NULL,
	`qty` decimal(19,6) NOT NULL,
	`unit_cost` decimal(19,6) NOT NULL,
	`amount` decimal(19,6) NOT NULL,
	CONSTRAINT `stock_transfer_lines_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_stock_transfer_lines_no` UNIQUE(`transfer_id`,`line_no`),
	CONSTRAINT `ck_stock_transfer_lines_qty` CHECK(`stock_transfer_lines`.`qty` > 0),
	CONSTRAINT `ck_stock_transfer_lines_cost` CHECK(`stock_transfer_lines`.`unit_cost` >= 0),
	CONSTRAINT `ck_stock_transfer_lines_amount` CHECK(`stock_transfer_lines`.`amount` >= 0)
);
--> statement-breakpoint
CREATE TABLE `stock_transfers` (
	`id` char(36) NOT NULL,
	`company_id` char(36) NOT NULL,
	`from_warehouse_id` char(36) NOT NULL,
	`to_warehouse_id` char(36) NOT NULL,
	`doc_no` varchar(32) NOT NULL,
	`movement_date` date NOT NULL,
	`note` varchar(200),
	`status` varchar(16) NOT NULL DEFAULT 'posted',
	`created_at` datetime(3) NOT NULL,
	`created_by` char(36) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	`updated_by` char(36) NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	CONSTRAINT `stock_transfers_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_stock_transfers_company_doc` UNIQUE(`company_id`,`doc_no`),
	CONSTRAINT `ck_stock_transfers_status` CHECK(`stock_transfers`.`status` in ('posted')),
	CONSTRAINT `ck_stock_transfers_distinct_warehouses` CHECK(`stock_transfers`.`from_warehouse_id` <> `stock_transfers`.`to_warehouse_id`)
);
--> statement-breakpoint
CREATE TABLE `stocktake_lines` (
	`id` char(36) NOT NULL,
	`company_id` char(36) NOT NULL,
	`stocktake_id` char(36) NOT NULL,
	`item_id` char(36) NOT NULL,
	`line_no` int NOT NULL,
	`book_qty` decimal(19,6) NOT NULL,
	`counted_qty` decimal(19,6) NOT NULL,
	`qty_delta` decimal(19,6) NOT NULL,
	`unit_cost` decimal(19,6) NOT NULL,
	`amount` decimal(19,6) NOT NULL,
	CONSTRAINT `stocktake_lines_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_stocktake_lines_no` UNIQUE(`stocktake_id`,`line_no`),
	CONSTRAINT `ck_stocktake_lines_book_qty` CHECK(`stocktake_lines`.`book_qty` >= 0),
	CONSTRAINT `ck_stocktake_lines_counted_qty` CHECK(`stocktake_lines`.`counted_qty` >= 0),
	CONSTRAINT `ck_stocktake_lines_delta` CHECK(`stocktake_lines`.`qty_delta` = `stocktake_lines`.`counted_qty` - `stocktake_lines`.`book_qty`),
	CONSTRAINT `ck_stocktake_lines_cost` CHECK(`stocktake_lines`.`unit_cost` >= 0),
	CONSTRAINT `ck_stocktake_lines_amount_direction` CHECK((`stocktake_lines`.`qty_delta` >= 0 and `stocktake_lines`.`amount` >= 0) or (`stocktake_lines`.`qty_delta` < 0 and `stocktake_lines`.`amount` <= 0))
);
--> statement-breakpoint
CREATE TABLE `stocktakes` (
	`id` char(36) NOT NULL,
	`company_id` char(36) NOT NULL,
	`warehouse_id` char(36) NOT NULL,
	`doc_no` varchar(32) NOT NULL,
	`movement_date` date NOT NULL,
	`note` varchar(200),
	`status` varchar(16) NOT NULL DEFAULT 'posted',
	`created_at` datetime(3) NOT NULL,
	`created_by` char(36) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	`updated_by` char(36) NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	CONSTRAINT `stocktakes_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_stocktakes_company_doc` UNIQUE(`company_id`,`doc_no`),
	CONSTRAINT `ck_stocktakes_status` CHECK(`stocktakes`.`status` in ('posted'))
);
--> statement-breakpoint
ALTER TABLE `stock_transfer_lines` ADD CONSTRAINT `stock_transfer_lines_company_id_companies_id_fk` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stock_transfer_lines` ADD CONSTRAINT `stock_transfer_lines_transfer_id_stock_transfers_id_fk` FOREIGN KEY (`transfer_id`) REFERENCES `stock_transfers`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stock_transfer_lines` ADD CONSTRAINT `stock_transfer_lines_item_id_items_id_fk` FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stock_transfers` ADD CONSTRAINT `stock_transfers_company_id_companies_id_fk` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stock_transfers` ADD CONSTRAINT `stock_transfers_from_warehouse_id_warehouses_id_fk` FOREIGN KEY (`from_warehouse_id`) REFERENCES `warehouses`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stock_transfers` ADD CONSTRAINT `stock_transfers_to_warehouse_id_warehouses_id_fk` FOREIGN KEY (`to_warehouse_id`) REFERENCES `warehouses`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stocktake_lines` ADD CONSTRAINT `stocktake_lines_company_id_companies_id_fk` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stocktake_lines` ADD CONSTRAINT `stocktake_lines_stocktake_id_stocktakes_id_fk` FOREIGN KEY (`stocktake_id`) REFERENCES `stocktakes`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stocktake_lines` ADD CONSTRAINT `stocktake_lines_item_id_items_id_fk` FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stocktakes` ADD CONSTRAINT `stocktakes_company_id_companies_id_fk` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stocktakes` ADD CONSTRAINT `stocktakes_warehouse_id_warehouses_id_fk` FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_stock_transfer_lines_company_item` ON `stock_transfer_lines` (`company_id`,`item_id`);--> statement-breakpoint
CREATE INDEX `idx_stock_transfers_company_date` ON `stock_transfers` (`company_id`,`movement_date`);--> statement-breakpoint
CREATE INDEX `idx_stock_transfers_company_from` ON `stock_transfers` (`company_id`,`from_warehouse_id`);--> statement-breakpoint
CREATE INDEX `idx_stock_transfers_company_to` ON `stock_transfers` (`company_id`,`to_warehouse_id`);--> statement-breakpoint
CREATE INDEX `idx_stocktake_lines_company_item` ON `stocktake_lines` (`company_id`,`item_id`);--> statement-breakpoint
CREATE INDEX `idx_stocktakes_company_date` ON `stocktakes` (`company_id`,`movement_date`);--> statement-breakpoint
CREATE INDEX `idx_stocktakes_company_warehouse` ON `stocktakes` (`company_id`,`warehouse_id`,`movement_date`);