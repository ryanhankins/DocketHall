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

"""Available DocketHall feature modules."""
from .agendas_module import MODULE as AGENDAS_MODULE
from .calendar_module import MODULE as CALENDAR_MODULE
from .citations_module import MODULE as CITATIONS_MODULE
from .codification_module import MODULE as CODIFICATION_MODULE
from .complaints_module import MODULE as COMPLAINTS_MODULE
from .directory_module import MODULE as DIRECTORY_MODULE
from .forms_module import MODULE as FORMS_MODULE
from .notices_module import MODULE as NOTICES_MODULE
from .pages_module import MODULE as PAGES_MODULE
from .permits_module import MODULE as PERMITS_MODULE
from .records_module import MODULE as RECORDS_MODULE
from .utilities_module import MODULE as UTILITIES_MODULE
from ..registry import register_module


def register_builtin_modules() -> None:
    register_module(AGENDAS_MODULE)
    register_module(PERMITS_MODULE)
    register_module(CODIFICATION_MODULE)
    register_module(RECORDS_MODULE)
    register_module(COMPLAINTS_MODULE)
    register_module(CALENDAR_MODULE)
    register_module(NOTICES_MODULE)
    register_module(DIRECTORY_MODULE)
    register_module(FORMS_MODULE)
    register_module(PAGES_MODULE)
    register_module(UTILITIES_MODULE)
    register_module(CITATIONS_MODULE)
