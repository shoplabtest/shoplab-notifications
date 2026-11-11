--
-- PostgreSQL database dump
--

\restrict 8MdfZmIekh483fQH2d8lMTET8FTZaM8V5PEK3qMvLLzZdruGnY5mcI4yzpLwXo9

-- Dumped from database version 16.15
-- Dumped by pg_dump version 16.15

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: channel_preferences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.channel_preferences (
    user_id uuid NOT NULL,
    channel text NOT NULL,
    enabled boolean NOT NULL,
    CONSTRAINT channel_preferences_channel_check CHECK ((channel = ANY (ARRAY['email'::text, 'push'::text])))
);


--
-- Name: contacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contacts (
    user_id uuid NOT NULL,
    email text NOT NULL,
    full_name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id bigint NOT NULL,
    user_id uuid,
    kind text NOT NULL,
    channel text NOT NULL,
    recipient text NOT NULL,
    dedupe_key text NOT NULL,
    subject text NOT NULL,
    body text NOT NULL,
    status text NOT NULL,
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    sent_at timestamp with time zone,
    CONSTRAINT notifications_channel_check CHECK ((channel = ANY (ARRAY['email'::text, 'push'::text]))),
    CONSTRAINT notifications_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'sent'::text, 'failed'::text, 'skipped'::text])))
);


--
-- Name: notifications_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.notifications_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: notifications_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.notifications_id_seq OWNED BY public.notifications.id;


--
-- Name: purchases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.purchases (
    order_id uuid NOT NULL,
    user_id uuid NOT NULL,
    product_id text NOT NULL,
    unit_price integer,
    placed_at timestamp with time zone NOT NULL
);


--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_migrations (
    name text NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: notifications id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications ALTER COLUMN id SET DEFAULT nextval('public.notifications_id_seq'::regclass);


--
-- Name: channel_preferences channel_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.channel_preferences
    ADD CONSTRAINT channel_preferences_pkey PRIMARY KEY (user_id, channel);


--
-- Name: contacts contacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contacts
    ADD CONSTRAINT contacts_pkey PRIMARY KEY (user_id);


--
-- Name: notifications notifications_dedupe_key_channel_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_dedupe_key_channel_key UNIQUE (dedupe_key, channel);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: purchases purchases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchases
    ADD CONSTRAINT purchases_pkey PRIMARY KEY (order_id, product_id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (name);


--
-- Name: notifications_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notifications_user_idx ON public.notifications USING btree (user_id, created_at DESC);


--
-- Name: purchases_product_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX purchases_product_idx ON public.purchases USING btree (product_id, placed_at DESC);


--
-- PostgreSQL database dump complete
--

\unrestrict 8MdfZmIekh483fQH2d8lMTET8FTZaM8V5PEK3qMvLLzZdruGnY5mcI4yzpLwXo9

