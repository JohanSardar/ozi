import { createFileRoute } from "@tanstack/react-router";
import { OziApp } from "../components/ozi/OziApp";

export const Route = createFileRoute("/_chat/")({ component: OziApp });
