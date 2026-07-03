# SPDX-License-Identifier: Apache-2.0
"""CRUD + phase transitions for bid_projects. Ownership enforced by user_id."""

from sqlalchemy.orm import Session

from app.models.bid_project import BidProject


class BidProjectService:
    @staticmethod
    def create(
        db: Session, *, user_id: int, title: str, workspace_ref: str
    ) -> BidProject:
        row = BidProject(
            user_id=user_id,
            title=title,
            workspace_ref=workspace_ref,
            phase_status={},
            current_phase=1,
            max_phase_reached=1,
            status="created",
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        return row

    @staticmethod
    def get(db: Session, *, user_id: int, project_id: int) -> BidProject | None:
        return (
            db.query(BidProject)
            .filter(BidProject.id == project_id, BidProject.user_id == user_id)
            .first()
        )

    @staticmethod
    def list(db: Session, *, user_id: int) -> list[BidProject]:
        return (
            db.query(BidProject)
            .filter(BidProject.user_id == user_id)
            .order_by(BidProject.created_at.desc())
            .all()
        )

    @staticmethod
    def reset_stuck_parsing(db: Session) -> int:
        """Flip projects stuck in 'parsing' to 'parse_failed'.

        Parsing runs as a non-durable asyncio task; a backend restart loses the
        in-flight task while the row stays 'parsing' forever. Called at startup
        so those projects become retryable instead of polling until timeout.
        """
        count = (
            db.query(BidProject)
            .filter(BidProject.status == "parsing")
            .update({BidProject.status: "parse_failed"}, synchronize_session=False)
        )
        db.commit()
        return count

    @staticmethod
    def mark_done(db: Session, *, project: BidProject) -> None:
        project.status = "done"
        db.commit()
        db.refresh(project)

    @staticmethod
    def begin_parse(db: Session, *, project_id: int, user_id: int) -> bool:
        # Atomic optimistic lock: only flip to 'parsing' if not already parsing.
        updated = (
            db.query(BidProject)
            .filter(
                BidProject.id == project_id,
                BidProject.user_id == user_id,
                BidProject.status != "parsing",
            )
            .update({BidProject.status: "parsing"}, synchronize_session=False)
        )
        db.commit()
        return updated == 1

    @staticmethod
    def complete_phase1(db: Session, *, project: BidProject) -> None:
        ps = dict(project.phase_status or {})
        ps["phase1"] = "done"
        project.phase_status = ps
        project.current_phase = 2
        project.max_phase_reached = max(project.max_phase_reached, 2)
        project.status = "parsed"
        db.commit()
        db.refresh(project)

    @staticmethod
    def set_phase_done(db: Session, *, project: BidProject, phase: int) -> None:
        ps = dict(project.phase_status or {})
        ps[f"phase{phase}"] = "done"
        project.phase_status = ps
        project.current_phase = phase + 1
        project.max_phase_reached = max(project.max_phase_reached, phase + 1)
        db.commit()
        db.refresh(project)

    @staticmethod
    def begin_draft(db: Session, *, project_id: int, user_id: int) -> bool:
        updated = (
            db.query(BidProject)
            .filter(
                BidProject.id == project_id,
                BidProject.user_id == user_id,
                BidProject.status != "drafting",
            )
            .update({BidProject.status: "drafting"}, synchronize_session=False)
        )
        db.commit()
        return updated == 1
