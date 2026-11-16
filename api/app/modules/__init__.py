# Copyright 2026 Ryan Hankins
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as
# published by the Free Software Foundation, either version 3 of the
# License, or (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU Affero General Public License for more details.
#
# You should have received a copy of the GNU Affero General Public License
# along with this program.  If not, see <https://www.gnu.org/licenses/>.

"""Available CivicDesk feature modules."""
from .agendas_module import MODULE as AGENDAS_MODULE
from .codification_module import MODULE as CODIFICATION_MODULE
from .permits_module import MODULE as PERMITS_MODULE
from ..registry import register_module


def register_builtin_modules() -> None:
    register_module(AGENDAS_MODULE)
    register_module(PERMITS_MODULE)
    register_module(CODIFICATION_MODULE)
