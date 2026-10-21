CREATE TABLE "cell_score" (
	"h3_r9" text NOT NULL,
	"hour" smallint NOT NULL,
	"score" smallint NOT NULL,
	"confidence" text NOT NULL,
	"components" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cell_score_h3_r9_hour_pk" PRIMARY KEY("h3_r9","hour")
);
--> statement-breakpoint
CREATE TABLE "poi" (
	"id" serial PRIMARY KEY NOT NULL,
	"osm_id" bigint NOT NULL,
	"category" text NOT NULL,
	"name" text,
	"opening_hours" text,
	"is_24x7" boolean DEFAULT false NOT NULL,
	"geom" geometry(Point, 4326) NOT NULL,
	"h3_r9" text NOT NULL,
	CONSTRAINT "poi_osm_id_unique" UNIQUE("osm_id")
);
--> statement-breakpoint
CREATE TABLE "report" (
	"id" serial PRIMARY KEY NOT NULL,
	"h3_r9" text NOT NULL,
	"category" text NOT NULL,
	"sentiment" smallint NOT NULL,
	"hour" smallint NOT NULL,
	"ip_hash" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "road_segment" (
	"id" serial PRIMARY KEY NOT NULL,
	"osm_id" bigint NOT NULL,
	"highway_class" text NOT NULL,
	"lit" text,
	"length_m" real NOT NULL,
	"geom" geometry(LineString, 4326) NOT NULL,
	"h3_r9" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "cell_score_hour_idx" ON "cell_score" USING btree ("hour");--> statement-breakpoint
CREATE INDEX "poi_h3_r9_idx" ON "poi" USING btree ("h3_r9");--> statement-breakpoint
CREATE INDEX "poi_category_idx" ON "poi" USING btree ("category");--> statement-breakpoint
CREATE INDEX "poi_geom_idx" ON "poi" USING gist ("geom");--> statement-breakpoint
CREATE INDEX "report_h3_r9_idx" ON "report" USING btree ("h3_r9");--> statement-breakpoint
CREATE INDEX "report_status_idx" ON "report" USING btree ("status");--> statement-breakpoint
CREATE INDEX "report_ip_hash_created_idx" ON "report" USING btree ("ip_hash","created_at");--> statement-breakpoint
CREATE INDEX "road_segment_h3_r9_idx" ON "road_segment" USING btree ("h3_r9");--> statement-breakpoint
CREATE INDEX "road_segment_osm_id_idx" ON "road_segment" USING btree ("osm_id");--> statement-breakpoint
CREATE INDEX "road_segment_geom_idx" ON "road_segment" USING gist ("geom");