# Overseer Playbook
#
# Copy this file to overseer-playbook.md and customize it.
# These preferences are included in every dispatch prompt
# the Overseer sends to Claude Code sessions.
#
# cp knowledge/overseer-playbook.example.md knowledge/overseer-playbook.md

## Testing Protocol
# - Define your testing expectations here
# - Example: ALWAYS write failing tests FIRST from acceptance criteria
# - Example: No request is complete without tests. No exceptions.

## General Rules
# - Example: Follow the action loop: Prime → Plan → Red → Green → Validate
# - Example: Always run tests before committing
# - Example: Update .claude/handoff.md at the end of every session

## Code Standards
# - Example: TypeScript strict mode, no `any` types
# - Example: Tailwind for styling, no inline styles

## When Stuck
# - Example: Don't retry the same approach more than twice
# - Example: If tests fail after fixing, write the failure to handoff and stop

## Human Tasks
# When Claude encounters something requiring human action, tag it:
# [HUMAN TODO] Description of what the human needs to do

## Project-Specific Overrides
# Add per-project rules here, for example:
# - my-project: always run seed after schema changes
# - my-api: check webhook signatures after deploy
