CREATE TABLE "topup_balances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"stripe_invoice_id" text NOT NULL,
	"credits_purchased" integer NOT NULL,
	"credits_remaining" integer NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "topup_balances" ADD CONSTRAINT "topup_balances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "topup_balances_stripe_invoice_idx" ON "topup_balances" USING btree ("stripe_invoice_id");--> statement-breakpoint
CREATE INDEX "topup_balances_user_expires_idx" ON "topup_balances" USING btree ("user_id","expires_at");